<?php

namespace App\Services\Media;

/** Real type of a media file from its first bytes (port of sniff()/verifyMedia() in server/remote-media.js). */
final class Sniffer
{
    public const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml'];
    public const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
    public const EXT = [
        'image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp', 'image/gif' => 'gif', 'image/avif' => 'avif', 'image/svg+xml' => 'svg',
        'video/mp4' => 'mp4', 'video/webm' => 'webm', 'video/quicktime' => 'mov',
    ];

    public static function sniff(string $b): string
    {
        if (str_starts_with($b, "\x89PNG\r\n\x1a\n")) {
            return 'image/png';
        }
        if (str_starts_with($b, "\xff\xd8\xff")) {
            return 'image/jpeg';
        }
        if (str_starts_with($b, 'GIF8')) {
            return 'image/gif';
        }
        if (str_starts_with($b, 'RIFF') && substr($b, 8, 4) === 'WEBP') {
            return 'image/webp';
        }
        if (str_starts_with($b, "\x1a\x45\xdf\xa3")) {
            return 'video/webm';
        }
        if (strlen($b) >= 12 && substr($b, 4, 4) === 'ftyp') {
            $brand = substr($b, 8, 4);
            if ($brand === 'avif' || $brand === 'avis') {
                return 'image/avif';
            }

            return $brand === 'qt  ' ? 'video/quicktime' : 'video/mp4';
        }
        $head = strtolower(ltrim(substr($b, 0, 1024)));
        if ((str_starts_with($head, '<svg') || str_starts_with($head, '<?xml')) && str_contains($head, '<svg')) {
            return 'image/svg+xml';
        }

        return '';
    }

    /** Trusted MIME type (the sniffed one wins over a wrong declaration) or a policy exception. */
    public static function verify(string $b, ?string $declared, string $kind): string
    {
        $allowed = $kind === 'video' ? self::VIDEO_TYPES : self::IMAGE_TYPES;
        $actual = self::sniff($b);
        if ($actual === '' || ! in_array($actual, $allowed, true)) {
            throw new MediaException($kind === 'video' ? 'NOT_A_VIDEO' : 'NOT_AN_IMAGE', true);
        }
        if ($declared && $declared !== $actual
            && ! (in_array($declared, self::VIDEO_TYPES, true) && in_array($actual, self::VIDEO_TYPES, true))
            && ! (in_array($declared, self::IMAGE_TYPES, true) && in_array($actual, self::IMAGE_TYPES, true))) {
            throw new MediaException('TYPE_MISMATCH', true);
        }

        return $actual;
    }

    public static function kindOf(string $mime): string
    {
        return in_array($mime, self::VIDEO_TYPES, true) ? 'video' : (in_array($mime, self::IMAGE_TYPES, true) ? 'image' : '');
    }
}
