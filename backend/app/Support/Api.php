<?php

namespace App\Support;

use Illuminate\Http\Response;

final class Api
{
    /** @param array<string,string> $headers */
    public static function json(int $status, mixed $value, array $headers = []): Response
    {
        return new Response(Json::encode($value), $status, ['Content-Type' => 'application/json', 'Cache-Control' => 'no-store', ...$headers]);
    }

    /** A body that is already JSON text (the cached /api/content snapshot). @param array<string,string> $headers */
    public static function raw(int $status, string $json, array $headers = []): Response
    {
        return new Response($json, $status, ['Content-Type' => 'application/json', 'Cache-Control' => 'no-store', ...$headers]);
    }

    /** The cookie of the Node API: HttpOnly, SameSite=Strict, Path=/api, Max-Age, Secure. (Symfony re-serialises it and adds a matching Expires.) */
    public static function cookie(string $name, string $token, int $age): string
    {
        return "$name=$token; HttpOnly; SameSite=Strict; Path=/api; Max-Age=$age".(config('dwira.cookie_secure') === false || config('dwira.cookie_secure') === 'false' ? '' : '; Secure');
    }

    public static function withCookie(Response $response, string $cookie): Response
    {
        $response->headers->set('Set-Cookie', $cookie, false);

        return $response;
    }
}
