<?php

namespace Tests\Unit;

use App\Services\Media\ImageProcessor;
use PHPUnit\Framework\TestCase;

class ImageProcessorTest extends TestCase
{
    protected function setUp(): void
    {
        if (! ImageProcessor::available()) {
            $this->markTestSkipped('GD with WebP is not available');
        }
    }

    private function image(int $w, int $h, string $type = 'png'): string
    {
        $im = imagecreatetruecolor($w, $h);
        for ($i = 0; $i < 40; $i++) { // noise, so recompression has something to win
            imagefilledellipse($im, random_int(0, $w), random_int(0, $h), random_int(5, $w / 2), random_int(5, $h / 2), imagecolorallocate($im, random_int(0, 255), random_int(0, 255), random_int(0, 255)));
        }
        ob_start();
        match ($type) {
            'jpeg' => imagejpeg($im, null, 98),
            'gif' => imagegif($im),
            default => imagepng($im, null, 0),
        };

        return (string) ob_get_clean();
    }

    public function test_large_png_becomes_a_smaller_webp_with_thumbnails(): void
    {
        $src = $this->image(1200, 800);
        $out = (new ImageProcessor(80, 2560, [320, 640]))->process($src, 'image/png');
        $this->assertTrue($out['converted']);
        $this->assertSame('image/webp', $out['mime']);
        $this->assertSame('webp', $out['ext']);
        $this->assertLessThan(strlen($src), strlen($out['body']));
        $this->assertSame([1200, 800], [$out['width'], $out['height']]);
        $this->assertSame('RIFF', substr($out['body'], 0, 4));
        $this->assertSame('WEBP', substr($out['body'], 8, 4));
        $this->assertSame([320, 640], array_keys($out['thumbs']));
        $this->assertSame(320, getimagesizefromstring($out['thumbs'][320])[0]);
        $this->assertSame(213, getimagesizefromstring($out['thumbs'][320])[1], 'aspect ratio kept');
        $this->assertLessThan(strlen($out['body']), strlen($out['thumbs'][320]));
    }

    public function test_oversized_images_are_scaled_down_to_the_maximum_dimension(): void
    {
        $out = (new ImageProcessor(80, 1000, [320]))->process($this->image(2000, 1000), 'image/png');
        $this->assertSame([1000, 500], [$out['width'], $out['height']]);
        $this->assertSame([1000, 500], array_slice(getimagesizefromstring($out['body']), 0, 2));
    }

    public function test_no_thumbnail_is_made_for_an_image_that_is_not_wider(): void
    {
        $out = (new ImageProcessor)->process($this->image(300, 200), 'image/png');
        $this->assertSame([], $out['thumbs']);
    }

    public function test_gif_svg_and_video_are_stored_as_uploaded(): void
    {
        $p = new ImageProcessor;
        $gif = $this->image(500, 400, 'gif');
        $o = $p->process($gif, 'image/gif');
        $this->assertFalse($o['converted']);
        $this->assertSame($gif, $o['body']);
        $this->assertSame('gif', $o['ext']);

        $svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';
        $o = $p->process($svg, 'image/svg+xml');
        $this->assertSame([$svg, 'svg', false], [$o['body'], $o['ext'], $o['converted']]);

        $mp4 = "\0\0\0\x18ftypmp42".str_repeat("\0", 30);
        $o = $p->process($mp4, 'video/mp4');
        $this->assertSame([$mp4, 'mp4', []], [$o['body'], $o['ext'], $o['thumbs']]);
    }

    public function test_corrupt_data_never_throws_and_is_kept(): void
    {
        $junk = "\x89PNG\r\n\x1a\n".random_bytes(200);
        $o = (new ImageProcessor)->process($junk, 'image/png');
        $this->assertSame($junk, $o['body']);
        $this->assertFalse($o['converted']);
    }

    public function test_an_image_that_does_not_shrink_is_kept_as_is(): void
    {
        // A tiny PNG: WebP is not smaller, so the original stays (no pointless conversion, same bytes, same URL).
        $tiny = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
        $o = (new ImageProcessor)->process($tiny, 'image/png');
        $this->assertSame($tiny, $o['body']);
        $this->assertSame('png', $o['ext']);
    }

    public function test_jpeg_is_recompressed(): void
    {
        $src = $this->image(1400, 900, 'jpeg');
        $o = (new ImageProcessor(70))->process($src, 'image/jpeg');
        $this->assertTrue($o['converted']);
        $this->assertLessThan(strlen($src), strlen($o['body']));
    }
}
