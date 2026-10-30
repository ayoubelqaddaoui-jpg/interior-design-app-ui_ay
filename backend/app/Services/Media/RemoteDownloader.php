<?php

namespace App\Services\Media;

use Closure;

/**
 * Safe one-time download of an external media URL (port of server/remote-media.js).
 *  - https only, port 443, no credentials, at most 3 redirects (each one re-checked)
 *  - every resolved address must be public; the connection is pinned to the checked address (CURLOPT_RESOLVE),
 *    so there is no DNS-rebinding window
 *  - 10 s overall timeout; size cap on Content-Length AND while streaming
 *  - type allowlist from Content-Type, confirmed by sniffing the first bytes
 * MediaException::$policy = the URL itself is unacceptable; false = transient failure (timeout, network, 5xx).
 */
class RemoteDownloader
{
    private const BLOCKED_V4 = [
        '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12',
        '192.0.0.0/24', '192.0.2.0/24', '192.88.99.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24',
        '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4',
    ];

    private const BLOCKED_V6 = [
        '::/8', '64:ff9b::/96', '64:ff9b:1::/48', '100::/64', '2001::/23', '2001:db8::/32', '2002::/16',
        'fc00::/7', 'fe80::/10', 'fec0::/10', 'ff00::/8',
    ];

    /**
     * @param  Closure|null  $resolver   fn(string $host): list<string>  (tests)
     * @param  Closure|null  $transport  fn(string $url, string $ip, array $headers, int $maxBytes, int $deadline): array{status:int,headers:array<string,string>,body:string} (tests)
     */
    public function __construct(private readonly ?Closure $resolver = null, private readonly ?Closure $transport = null)
    {
    }

    public static function isPrivateAddress(string $address): bool
    {
        $bin = @inet_pton($address);
        if ($bin === false) {
            return true; // unknown format counts as private
        }
        if (strlen($bin) === 4) {
            return self::inAny($bin, self::BLOCKED_V4);
        }
        // IPv4-mapped (::ffff:a.b.c.d): judge the embedded IPv4 address.
        if (str_starts_with($bin, str_repeat("\0", 10)."\xff\xff")) {
            return self::inAny(substr($bin, 12), self::BLOCKED_V4) || self::inAny($bin, self::BLOCKED_V6);
        }

        return self::inAny($bin, self::BLOCKED_V6);
    }

    /** @param list<string> $cidrs */
    private static function inAny(string $bin, array $cidrs): bool
    {
        foreach ($cidrs as $cidr) {
            [$net, $prefix] = explode('/', $cidr);
            $netBin = inet_pton($net);
            if (strlen($netBin) !== strlen($bin)) {
                continue;
            }
            $prefix = (int) $prefix;
            $bytes = intdiv($prefix, 8);
            if ($bytes > 0 && substr($bin, 0, $bytes) !== substr($netBin, 0, $bytes)) {
                continue;
            }
            $rest = $prefix % 8;
            if ($rest === 0) {
                return true;
            }
            $mask = (0xFF << (8 - $rest)) & 0xFF;
            if ((ord($bin[$bytes]) & $mask) === (ord($netBin[$bytes]) & $mask)) {
                return true;
            }
        }

        return false;
    }

    /** @return array{scheme:string,host:string,path:string,query:?string} */
    public static function parse(string $value): array
    {
        $u = parse_url($value);
        if ($u === false || ! isset($u['scheme'], $u['host'])) {
            throw new MediaException('INVALID_URL');
        }
        if (strtolower($u['scheme']) !== 'https') {
            throw new MediaException('HTTPS_REQUIRED');
        }
        if (isset($u['user']) || isset($u['pass'])) {
            throw new MediaException('CREDENTIALS_NOT_ALLOWED');
        }
        if (isset($u['port']) && (int) $u['port'] !== 443) {
            throw new MediaException('PORT_NOT_ALLOWED');
        }
        $host = trim($u['host'], '[]');
        if ($host === '') {
            throw new MediaException('INVALID_URL');
        }
        if (filter_var($host, FILTER_VALIDATE_IP) && self::isPrivateAddress($host)) {
            throw new MediaException('PRIVATE_ADDRESS');
        }

        return ['scheme' => 'https', 'host' => $host, 'path' => $u['path'] ?? '/', 'query' => $u['query'] ?? null];
    }

    /** @return list<string> */
    private function resolve(string $host): array
    {
        if (filter_var($host, FILTER_VALIDATE_IP)) {
            return [$host];
        }
        if ($this->resolver) {
            return ($this->resolver)($host);
        }
        $ips = [];
        foreach (@dns_get_record($host, DNS_A | DNS_AAAA) ?: [] as $r) {
            $ips[] = $r['ip'] ?? $r['ipv6'] ?? null;
        }
        $ips = array_values(array_filter($ips));
        if (! $ips) {
            $ips = @gethostbynamel($host) ?: [];
        }

        return $ips;
    }

    /** @return array{body:string,mime:string} */
    public function download(string $input, string $kind = 'image', int $maxBytes = 10485760, int $timeoutMs = 10000): array
    {
        $deadline = (int) (microtime(true) * 1000) + $timeoutMs;
        $accept = $kind === 'video' ? implode(',', Sniffer::VIDEO_TYPES) : 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml;q=0.8';
        $allowed = $kind === 'video' ? Sniffer::VIDEO_TYPES : Sniffer::IMAGE_TYPES;
        $current = $input;
        for ($hop = 0; $hop <= 3; $hop++) {
            $parts = self::parse($current);
            $ips = $this->resolve($parts['host']);
            if (! $ips) {
                throw new MediaException('NETWORK_ERROR', false);
            }
            foreach ($ips as $ip) {
                if (self::isPrivateAddress($ip)) {
                    throw new MediaException('PRIVATE_ADDRESS');
                }
            }
            $url = 'https://'.(str_contains($parts['host'], ':') ? "[{$parts['host']}]" : $parts['host']).$parts['path'].($parts['query'] !== null ? '?'.$parts['query'] : '');
            $res = $this->fetch($url, $parts['host'], $ips[0], ['Accept: '.$accept, 'User-Agent: DwiraMediaImporter/1.0'], $maxBytes, $deadline);
            $status = $res['status'];
            if (in_array($status, [301, 302, 303, 307, 308], true)) {
                $location = $res['headers']['location'] ?? '';
                if ($location === '') {
                    throw new MediaException('BAD_REDIRECT');
                }
                $current = self::absolute($url, $location);
                continue;
            }
            if ($status !== 200) {
                throw new MediaException("HTTP_$status", ! ($status >= 500 || $status === 429));
            }
            $declared = strtolower(trim(explode(';', $res['headers']['content-type'] ?? '')[0]));
            if (! in_array($declared, $allowed, true)) {
                throw new MediaException($kind === 'video' ? 'NOT_A_VIDEO' : 'NOT_AN_IMAGE');
            }
            if ($res['body'] === '') {
                throw new MediaException('EMPTY');
            }

            return ['body' => $res['body'], 'mime' => Sniffer::verify($res['body'], $declared, $kind)];
        }
        throw new MediaException('TOO_MANY_REDIRECTS');
    }

    private static function absolute(string $base, string $location): string
    {
        if (preg_match('#^[a-z][a-z0-9+.-]*://#i', $location)) {
            return $location;
        }
        $b = parse_url($base);
        $origin = $b['scheme'].'://'.$b['host'];
        if (str_starts_with($location, '//')) {
            return $b['scheme'].':'.$location;
        }
        if (str_starts_with($location, '/')) {
            return $origin.$location;
        }
        $dir = preg_replace('#/[^/]*$#', '/', $b['path'] ?? '/');

        return $origin.$dir.$location;
    }

    /** @return array{status:int,headers:array<string,string>,body:string} */
    private function fetch(string $url, string $host, string $ip, array $headers, int $maxBytes, int $deadline): array
    {
        $remaining = max(1, $deadline - (int) (microtime(true) * 1000));
        if ($this->transport) {
            return ($this->transport)($url, $ip, $headers, $maxBytes, $deadline);
        }
        $body = '';
        $resp = [];
        $tooLarge = false;
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_RESOLVE => ["$host:443:".(str_contains($ip, ':') ? "[$ip]" : $ip)],
            CURLOPT_TIMEOUT_MS => $remaining,
            CURLOPT_CONNECTTIMEOUT_MS => min(5000, $remaining),
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HEADERFUNCTION => function ($c, $line) use (&$resp, $maxBytes, &$tooLarge) {
                if (str_contains($line, ':')) {
                    [$k, $v] = explode(':', $line, 2);
                    $resp[strtolower(trim($k))] = trim($v);
                    if (strtolower(trim($k)) === 'content-length' && (int) trim($v) > $maxBytes) {
                        $tooLarge = true;

                        return -1;
                    }
                }

                return strlen($line);
            },
            CURLOPT_WRITEFUNCTION => function ($c, $chunk) use (&$body, $maxBytes, &$tooLarge) {
                $body .= $chunk;
                if (strlen($body) > $maxBytes) {
                    $tooLarge = true;

                    return -1;
                }

                return strlen($chunk);
            },
        ]);
        curl_exec($ch);
        $errno = curl_errno($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if ($tooLarge) {
            throw new MediaException('TOO_LARGE');
        }
        if ($errno !== 0) {
            throw new MediaException($errno === CURLE_OPERATION_TIMEDOUT ? 'TIMEOUT' : 'NETWORK_ERROR', false);
        }

        return ['status' => $status, 'headers' => $resp, 'body' => $body];
    }
}
