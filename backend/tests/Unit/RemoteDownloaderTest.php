<?php

namespace Tests\Unit;

use App\Services\Media\MediaException;
use App\Services\Media\RemoteDownloader as D;
use PHPUnit\Framework\TestCase;

class RemoteDownloaderTest extends TestCase
{
    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    private function png(): string
    {
        return base64_decode(self::PNG);
    }

    /** @param array<string,array{status:int,headers?:array,body?:string}> $routes url => response */
    private function dl(array $routes, array $dns = [], ?array &$calls = null): D
    {
        $calls = [];

        return new D(
            fn (string $host) => $dns[$host] ?? ['93.184.216.34'],
            function (string $url, string $ip, array $headers) use ($routes, &$calls) {
                $calls[] = ['url' => $url, 'ip' => $ip];
                $r = $routes[$url] ?? ['status' => 404];

                return ['status' => $r['status'], 'headers' => $r['headers'] ?? [], 'body' => $r['body'] ?? ''];
            },
        );
    }

    private function code(callable $fn): array
    {
        try {
            $fn();
        } catch (MediaException $e) {
            return [$e->errorCode, $e->policy];
        }
        $this->fail('expected a MediaException');
    }

    public function test_private_and_special_addresses_are_blocked(): void
    {
        foreach (['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
            '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '2001:db8::1', 'not-an-ip',
            '::ffff:8.8.8.8' /* like Node: ::/8 covers every IPv4-mapped address, so mapped addresses are always refused */] as $ip) {
            $this->assertTrue(D::isPrivateAddress($ip), $ip);
        }
        foreach (['93.184.216.34', '8.8.8.8', '172.15.0.1', '172.32.0.1', '1.1.1.1', '2606:4700:4700::1111'] as $ip) {
            $this->assertFalse(D::isPrivateAddress($ip), $ip);
        }
    }

    public function test_url_policy(): void
    {
        $this->assertSame(['HTTPS_REQUIRED', true], $this->code(fn () => D::parse('http://example.com/a.png')));
        $this->assertSame(['HTTPS_REQUIRED', true], $this->code(fn () => D::parse('ftp://example.com/a.png')));
        $this->assertSame(['CREDENTIALS_NOT_ALLOWED', true], $this->code(fn () => D::parse('https://user:pw@example.com/a.png')));
        $this->assertSame(['PORT_NOT_ALLOWED', true], $this->code(fn () => D::parse('https://example.com:8443/a.png')));
        $this->assertSame(['PRIVATE_ADDRESS', true], $this->code(fn () => D::parse('https://127.0.0.1/a.png')));
        $this->assertSame(['PRIVATE_ADDRESS', true], $this->code(fn () => D::parse('https://[::1]/a.png')));
        $this->assertSame(['INVALID_URL', true], $this->code(fn () => D::parse('//example.com/a.png')));
        $this->assertSame(['INVALID_URL', true], $this->code(fn () => D::parse('nonsense')));
        $this->assertSame('example.com', D::parse('https://example.com:443/a.png?x=1')['host']);
    }

    public function test_downloads_and_verifies_the_real_type(): void
    {
        $d = $this->dl(['https://cdn.example/a.png' => ['status' => 200, 'headers' => ['content-type' => 'image/png; charset=x'], 'body' => $this->png()]], [], $calls);
        $r = $d->download('https://cdn.example/a.png');
        $this->assertSame('image/png', $r['mime']);
        $this->assertSame($this->png(), $r['body']);
        $this->assertSame('93.184.216.34', $calls[0]['ip'], 'the connection is pinned to the checked address');
    }

    public function test_a_hostname_that_resolves_to_a_private_address_is_refused_before_any_request(): void
    {
        $d = $this->dl(['https://rebind.example/a.png' => ['status' => 200]], ['rebind.example' => ['93.184.216.34', '10.0.0.5']], $calls);
        $this->assertSame(['PRIVATE_ADDRESS', true], $this->code(fn () => $d->download('https://rebind.example/a.png')));
        $this->assertSame([], $calls, 'nothing was fetched');
    }

    public function test_no_dns_answer_is_a_transient_error(): void
    {
        $d = $this->dl([], ['gone.example' => []]);
        $this->assertSame(['NETWORK_ERROR', false], $this->code(fn () => $d->download('https://gone.example/a.png')));
    }

    public function test_redirects_are_followed_and_every_hop_is_rechecked(): void
    {
        $png = ['status' => 200, 'headers' => ['content-type' => 'image/png'], 'body' => $this->png()];
        $d = $this->dl([
            'https://a.example/x' => ['status' => 302, 'headers' => ['location' => '/y']],
            'https://a.example/y' => ['status' => 301, 'headers' => ['location' => 'https://b.example/z.png']],
            'https://b.example/z.png' => $png,
        ], [], $calls);
        $this->assertSame('image/png', $d->download('https://a.example/x')['mime']);
        $this->assertCount(3, $calls);

        // redirect to http, to a private literal, and to a host that resolves privately
        foreach (['http://b.example/z.png' => 'HTTPS_REQUIRED', 'https://127.0.0.1/z.png' => 'PRIVATE_ADDRESS', 'https://evil.example/z.png' => 'PRIVATE_ADDRESS'] as $target => $why) {
            $d = $this->dl(['https://a.example/x' => ['status' => 302, 'headers' => ['location' => $target]]], ['evil.example' => ['192.168.0.9']]);
            $this->assertSame([$why, true], $this->code(fn () => $d->download('https://a.example/x')), $target);
        }
        $d = $this->dl(['https://a.example/x' => ['status' => 302, 'headers' => []]]);
        $this->assertSame(['BAD_REDIRECT', true], $this->code(fn () => $d->download('https://a.example/x')));
    }

    public function test_redirect_loops_stop_after_three_hops(): void
    {
        $d = $this->dl(['https://a.example/x' => ['status' => 302, 'headers' => ['location' => 'https://a.example/x']]], [], $calls);
        $this->assertSame(['TOO_MANY_REDIRECTS', true], $this->code(fn () => $d->download('https://a.example/x')));
        $this->assertCount(4, $calls);
    }

    public function test_http_errors_distinguish_policy_from_transient(): void
    {
        foreach ([404 => true, 403 => true, 500 => false, 503 => false, 429 => false] as $status => $policy) {
            $d = $this->dl(['https://a.example/x' => ['status' => $status]]);
            $this->assertSame(["HTTP_$status", $policy], $this->code(fn () => $d->download('https://a.example/x')), (string) $status);
        }
    }

    public function test_content_type_and_bytes_must_agree(): void
    {
        $cases = [
            'html page' => [['content-type' => 'text/html'], '<html>', 'NOT_AN_IMAGE'],
            'no content type' => [[], $this->png(), 'NOT_AN_IMAGE'],
            'png claimed, html sent' => [['content-type' => 'image/png'], '<html>not an image</html>', 'NOT_AN_IMAGE'],
            'empty body' => [['content-type' => 'image/png'], '', 'EMPTY'],
        ];
        foreach ($cases as $name => [$h, $body, $why]) {
            $d = $this->dl(['https://a.example/x' => ['status' => 200, 'headers' => $h, 'body' => $body]]);
            $this->assertSame([$why, true], $this->code(fn () => $d->download('https://a.example/x')), $name);
        }
        // a video is not accepted as an image, and vice versa
        $mp4 = "\x00\x00\x00\x18ftypmp42".str_repeat("\0", 20);
        $d = $this->dl(['https://a.example/v' => ['status' => 200, 'headers' => ['content-type' => 'video/mp4'], 'body' => $mp4]]);
        $this->assertSame(['NOT_AN_IMAGE', true], $this->code(fn () => $d->download('https://a.example/v', 'image')));
        $this->assertSame('video/mp4', $d->download('https://a.example/v', 'video')['mime']);
    }

    public function test_a_sniffed_image_type_wins_over_a_wrong_image_declaration(): void
    {
        $d = $this->dl(['https://a.example/x' => ['status' => 200, 'headers' => ['content-type' => 'image/jpeg'], 'body' => $this->png()]]);
        $this->assertSame('image/png', $d->download('https://a.example/x')['mime']);
    }
}
