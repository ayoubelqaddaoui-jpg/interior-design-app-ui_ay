<?php

namespace App\Support;

use Illuminate\Http\Request;

/** `readBody()` of the Node API: JSON only, 4 MB max, decoded to objects (so `{}` stays `{}`). */
final class Body
{
    public const MAX = 4 * 1024 * 1024;

    public static function read(Request $request): mixed
    {
        $type = (string) $request->headers->get('Content-Type', '');
        if (! str_starts_with($type, 'application/json')) {
            throw fail(415, 'JSON required');
        }
        $raw = $request->getContent();
        if (strlen($raw) > self::MAX) {
            throw fail(413, 'Request too large');
        }
        try {
            return Json::decode($raw);
        } catch (\JsonException) {
            throw fail(400, 'Invalid JSON');
        }
    }

    /** `body.key` of a decoded body: null when the body is not an object or the key is missing. */
    public static function get(mixed $body, string $key): mixed
    {
        return $body instanceof \stdClass ? ($body->{$key} ?? null) : null;
    }

    public static function has(mixed $body, string $key): bool
    {
        return $body instanceof \stdClass && property_exists($body, $key);
    }
}
