<?php

namespace App\Http\Middleware;

use App\Support\ApiException;
use App\Support\RateLimit;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * First thing every /api request meets (global middleware, so it also covers OPTIONS and unknown routes).
 *
 *  1. Origin check (CORS + CSRF): same-origin and APP_URL / APP_ORIGINS are allowed, any other `Origin` -> 403.
 *     A browser always sends `Origin` on cross-site POST/PATCH/DELETE, and `Sec-Fetch-Site: cross-site` is refused too
 *     when the origin is not allowed, so a forged form/fetch from another site never reaches a controller. The session
 *     cookies are additionally `SameSite=Strict` and every write needs `Content-Type: application/json`.
 *  2. CORS headers for allowed cross-origin callers (credentials allowed), `OPTIONS` answered with 204.
 *  3. Rate limit (media reads are exempt: one screen shows dozens of pictures).
 *  4. `nosniff` / `no-referrer` on every API response.
 */
class ApiGate
{
    private const ALLOW_HEADERS = 'Content-Type, Authorization, X-Demand-Token, X-Dwira-Native, X-User-Token';
    private const ALLOW_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';

    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->is('api', 'api/*')) {
            return $next($request);
        }
        $origin = $request->headers->get('Origin');
        $cors = [];
        if ($origin !== null && $origin !== '') {
            if (! $this->sameOrigin($request, $origin) && ! in_array($origin, $this->allowedOrigins(), true)) {
                return $this->finish(ApiException::response(403, 'Origin not allowed'), []);
            }
            $cors = ['Access-Control-Allow-Origin' => $origin, 'Access-Control-Allow-Credentials' => 'true', 'Vary' => 'Origin'];
        } elseif ($request->headers->get('Sec-Fetch-Site') === 'cross-site' && ! in_array($request->method(), ['GET', 'HEAD', 'OPTIONS'], true)) {
            // A browser that hides Origin but declares the request cross-site: nothing legitimate does that.
            return $this->finish(ApiException::response(403, 'Origin not allowed'), []);
        }
        $cors['Access-Control-Allow-Headers'] = self::ALLOW_HEADERS;
        $cors['Access-Control-Allow-Methods'] = self::ALLOW_METHODS;

        if ($request->isMethod('OPTIONS')) {
            return $this->finish(new \Illuminate\Http\Response('', 204), $cors);
        }

        $path = '/'.ltrim($request->getPathInfo(), '/');
        $isMedia = str_starts_with($path, '/api/media/') && in_array($request->method(), ['GET', 'HEAD'], true);
        if (! $isMedia && ! RateLimit::hit((string) $request->ip(), RateLimit::bucketFor($path))) {
            return $this->finish(ApiException::response(429, 'Too many requests'), $cors);
        }

        return $this->finish($next($request), $cors);
    }

    /** @param array<string,string> $headers */
    private function finish(Response $response, array $headers): Response
    {
        foreach ($headers as $name => $value) {
            $response->headers->set($name, $value);
        }
        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('Referrer-Policy', 'no-referrer');

        return $response;
    }

    private function sameOrigin(Request $request, string $origin): bool
    {
        if (! preg_match('#^https?://#', $origin)) {
            return false;
        }
        $parts = parse_url($origin);
        if (! isset($parts['host'])) {
            return false;
        }
        $host = $parts['host'].(isset($parts['port']) ? ':'.$parts['port'] : '');

        return strcasecmp($host, $request->getHttpHost()) === 0;
    }

    /** APP_ORIGINS plus the site's own APP_URL (so www / apex mismatches behind a proxy never lock the owner out). @return list<string> */
    private function allowedOrigins(): array
    {
        $list = config('dwira.origins', []);
        $own = rtrim((string) config('app.url'), '/');
        if ($own !== '' && preg_match('#^https?://[^/]+$#', $own)) {
            $list[] = $own;
        }

        return $list;
    }
}
