<?php

namespace App\Support;

/**
 * JSON exactly the way the Node API wrote it: no escaped slashes or unicode, `{}` stays `{}` (objects decode to stdClass,
 * never to arrays, so an empty object is never turned into `[]`).
 */
final class Json
{
    public static function encode(mixed $value): string
    {
        return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_LINE_TERMINATORS | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR);
    }

    /** @return mixed stdClass for objects, array for lists. Throws JsonException on invalid input. */
    public static function decode(string $json): mixed
    {
        return json_decode($json, false, 512, JSON_THROW_ON_ERROR);
    }

    /** Decode that never throws: returns $default when the text is not valid JSON. */
    public static function tryDecode(?string $json, mixed $default = null): mixed
    {
        if ($json === null || $json === '') {
            return $default;
        }
        try {
            return self::decode($json);
        } catch (\JsonException) {
            return $default;
        }
    }

    public static function isObject(mixed $value): bool
    {
        return $value instanceof \stdClass;
    }

    /** `{...$a, ...$b}` for stdClass objects (JS spread semantics: later keys win, key order of first appearance). */
    public static function merge(mixed ...$objects): \stdClass
    {
        $out = new \stdClass;
        foreach ($objects as $object) {
            if ($object instanceof \stdClass) {
                foreach ($object as $key => $value) {
                    $out->{$key} = $value;
                }
            }
        }

        return $out;
    }
}
