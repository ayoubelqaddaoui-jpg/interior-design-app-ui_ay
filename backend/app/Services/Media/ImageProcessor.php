<?php

namespace App\Services\Media;

/**
 * Resize + recompress to WebP with GD (present on every shared host; no Imagick / ffmpeg needed).
 * Never fails an upload: whatever GD cannot handle (animated GIF, SVG, AVIF without support, huge pixel counts, corrupt
 * data) is stored exactly as uploaded.
 */
final class ImageProcessor
{
    private const MAX_PIXELS = 48_000_000; // ~192 MB as a GD truecolor bitmap: above this keep the original

    public function __construct(private readonly int $quality = 82, private readonly int $maxDimension = 2560, private readonly array $thumbWidths = [320, 640])
    {
    }

    public static function available(): bool
    {
        return function_exists('imagewebp') && function_exists('imagecreatefromstring');
    }

    /** @return array{body:string,mime:string,ext:string,width:?int,height:?int,thumbs:array<int,string>,converted:bool} */
    public function process(string $body, string $mime): array
    {
        $plain = ['body' => $body, 'mime' => $mime, 'ext' => Sniffer::EXT[$mime], 'width' => null, 'height' => null, 'thumbs' => [], 'converted' => false];
        if (Sniffer::kindOf($mime) !== 'image' || $mime === 'image/svg+xml') {
            return $plain;
        }
        $info = @getimagesizefromstring($body);
        if ($info) {
            $plain['width'] = (int) $info[0];
            $plain['height'] = (int) $info[1];
        }
        if (! self::available() || $mime === 'image/gif' || ! $info || $info[0] * $info[1] > self::MAX_PIXELS) {
            return $plain;
        }
        $image = @imagecreatefromstring($body);
        if (! $image) {
            return $plain;
        }
        try {
            if ($mime === 'image/jpeg') {
                $image = $this->orient($image, $body);
            }
            $w = imagesx($image);
            $h = imagesy($image);
            $resized = false;
            if (max($w, $h) > $this->maxDimension) {
                $scale = $this->maxDimension / max($w, $h);
                $image = $this->scale($image, max(1, (int) round($w * $scale)), max(1, (int) round($h * $scale)));
                $resized = true;
                $w = imagesx($image);
                $h = imagesy($image);
            }
            $webp = $this->encode($image, $this->quality);
            // Keep the upload when recompression does not help (already tiny JPEG/WebP) and nothing was resized.
            $keep = ! $resized && ($webp === null || (strlen($webp) >= strlen($body) && in_array($mime, ['image/jpeg', 'image/webp', 'image/png'], true)));
            $out = $plain;
            $out['width'] = $w;
            $out['height'] = $h;
            if (! $keep) {
                $out['body'] = $webp;
                $out['mime'] = 'image/webp';
                $out['ext'] = 'webp';
                $out['converted'] = true;
            }
            foreach ($this->thumbWidths as $tw) {
                if ($w > $tw) {
                    $thumb = $this->scale($image, $tw, max(1, (int) round($h * $tw / $w)));
                    $data = $this->encode($thumb, 75);
                    if ($data !== null) {
                        $out['thumbs'][$tw] = $data;
                    }
                }
            }

            return $out;
        } finally {
            unset($image);
        }
    }

    private function encode(\GdImage $image, int $quality): ?string
    {
        if (! imageistruecolor($image)) {
            imagepalettetotruecolor($image);
        }
        imagealphablending($image, false);
        imagesavealpha($image, true);
        ob_start();
        $ok = @imagewebp($image, null, $quality);
        $data = (string) ob_get_clean();

        return $ok && $data !== '' ? $data : null;
    }

    private function scale(\GdImage $src, int $w, int $h): \GdImage
    {
        $dst = imagecreatetruecolor($w, $h);
        imagealphablending($dst, false);
        imagesavealpha($dst, true);
        imagefill($dst, 0, 0, imagecolorallocatealpha($dst, 0, 0, 0, 127));
        imagecopyresampled($dst, $src, 0, 0, 0, 0, $w, $h, imagesx($src), imagesy($src));

        return $dst;
    }

    private function orient(\GdImage $image, string $body): \GdImage
    {
        if (! function_exists('exif_read_data')) {
            return $image;
        }
        $stream = fopen('php://memory', 'r+');
        fwrite($stream, $body);
        rewind($stream);
        $exif = @exif_read_data($stream);
        fclose($stream);
        $angle = match ((int) ($exif['Orientation'] ?? 1)) {
            3 => 180, 6 => -90, 8 => 90, default => 0,
        };
        if ($angle) {
            $rotated = imagerotate($image, $angle, 0);
            if ($rotated) {
                return $rotated;
            }
        }

        return $image;
    }
}
