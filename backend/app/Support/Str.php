<?php

namespace App\Support;

/** String helpers with JavaScript semantics (the Node API measured and trimmed strings the JS way). */
final class Str
{
    /** `String.prototype.trim()` (Unicode white space + BOM). */
    public static function jsTrim(string $s): string
    {
        return preg_replace('/^[\s\x{FEFF}]+|[\s\x{FEFF}]+$/u', '', $s) ?? $s;
    }

    /** `String.prototype.length` (UTF-16 code units: an emoji counts 2). */
    public static function jsLength(string $s): int
    {
        return intdiv(strlen(mb_convert_encoding($s, 'UTF-16LE', 'UTF-8')), 2);
    }

    /** `Array.from(s).slice(0, max).join('')` (code points). */
    public static function cut(string $s, int $max): string
    {
        return mb_substr($s, 0, $max, 'UTF-8');
    }

    public static function sha256(string $value): string
    {
        return hash('sha256', $value);
    }
}
