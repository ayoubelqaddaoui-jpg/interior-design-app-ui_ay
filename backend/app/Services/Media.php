<?php

namespace App\Services;

use App\Services\Media\ImageProcessor;
use App\Services\Media\MediaException;
use App\Services\Media\RemoteDownloader;
use App\Services\Media\Sniffer;
use Illuminate\Support\Facades\DB;

/**
 * All media of the app goes through here (port of server/media.js, with local disk instead of R2/database bytes).
 *
 *  - id  = first 32 hex of sha256(base64(original bytes))  -> identical to the Node ids, so existing URLs keep working
 *  - URL = /api/media/<id>.<orig_ext>   (orig_ext = extension of the ORIGINAL type, e.g. .png even if stored as WebP)
 *  - file= storage/app/public/media/<id>.<ext>  (+ <id>_320.webp / <id>_640.webp thumbnails)
 */
class Media
{
    public const PREFIX = '/api/media/';

    private const DATA_URL = '#^data:([a-z]+/[a-z0-9.+-]+);base64,#i';

    private const NAME = '/^([a-f0-9]{32})\.(png|jpg|webp|gif|avif|svg|mp4|webm|mov)$/';

    private const ABSOLUTE = '#^https?://[^/]+(/api/media/[a-f0-9]{32}\.[a-z0-9]+)$#';

    /** Keys whose string value is a picture shown by the app (external https URLs there are copied into storage). */
    public const MEDIA_KEYS = ['image', 'cover', 'poster', 'logoUri', 'loaderCustomUri', 'photoUri', 'aiResult', 'finalResult', 'before', 'after', 'uri'];

    /** @var array<string,string> */
    private array $remoteCache = [];

    private array $saved = [];

    public function __construct(private readonly ?ImageProcessor $processor = null, private readonly ?RemoteDownloader $downloader = null)
    {
    }

    public static function dir(): string
    {
        return storage_path('app/public/media');
    }

    public static function limit(string $kind): int
    {
        return (int) config($kind === 'video' ? 'dwira.media.max_video_mb' : 'dwira.media.max_image_mb') * 1024 * 1024;
    }

    public function rawLimit(string $kind): int
    {
        return self::limit($kind);
    }

    public static function idOf(string $body): string
    {
        return substr(hash('sha256', base64_encode($body)), 0, 32);
    }

    private function processor(): ImageProcessor
    {
        return $this->processor ?? new ImageProcessor(
            (int) config('dwira.media.webp_quality', 82),
            (int) config('dwira.media.max_dimension', 2560),
            (array) config('dwira.media.thumb_widths', [320, 640]),
        );
    }

    /** THE single write path. Content-addressed, so storing the same bytes twice is free (idempotent). */
    public function storeMedia(string $body, string $mime, ?string $forceId = null, ?string $urlMime = null): string
    {
        if (! isset(Sniffer::EXT[$mime])) {
            throw fail(400, 'UNSUPPORTED_MEDIA');
        }
        // $forceId / $urlMime exist for the Postgres import: a file keeps the id and the extension of the URLs already issued.
        $id = $forceId ?? self::idOf($body);
        $origExt = Sniffer::EXT[$urlMime ?? $mime] ?? Sniffer::EXT[$mime];
        $url = self::PREFIX.$id.'.'.$origExt;
        if (isset($this->saved[$id])) {
            return $url;
        }
        $row = DB::table('media')->where('id', $id)->first();
        if ($row && is_file(self::dir().'/'.$id.'.'.$row->ext)) {
            $this->saved[$id] = true;

            return self::PREFIX.$id.'.'.$row->orig_ext;
        }
        $out = $this->processor()->process($body, $mime);
        $dir = self::dir();
        if (! is_dir($dir) && ! @mkdir($dir, 0775, true) && ! is_dir($dir)) {
            throw new MediaException('STORAGE_UNAVAILABLE', false);
        }
        $this->write("$dir/$id.{$out['ext']}", $out['body']);
        foreach ($out['thumbs'] as $w => $data) {
            $this->write("$dir/{$id}_$w.webp", $data);
        }
        Sql::insertIfAbsent('media', [
            'id' => $id, 'mime' => $out['mime'], 'ext' => $out['ext'], 'orig_ext' => $origExt, 'size' => strlen($out['body']),
            'width' => $out['width'], 'height' => $out['height'], 'storage' => 'disk', 'created_at' => now_ms(),
        ]);
        $this->saved[$id] = true;

        return $url;
    }

    private function write(string $path, string $data): void
    {
        $tmp = $path.'.'.bin2hex(random_bytes(4)).'.tmp';
        if (file_put_contents($tmp, $data) === false || ! @rename($tmp, $path)) {
            @unlink($tmp);
            throw new MediaException('STORAGE_UNAVAILABLE', false);
        }
    }

    /** A `data:` URL from an upload: decoded, its real type checked, then stored. */
    public function storeDataUrl(string $value, bool $svg = true): string
    {
        preg_match(self::DATA_URL, $value, $m);
        $declared = strtolower($m[1]);
        $body = (string) base64_decode(substr($value, strlen($m[0])));
        $kind = Sniffer::kindOf($declared);
        if ($kind === '' || $body === '') {
            throw fail(400, 'INVALID_MEDIA');
        }
        if (strlen($body) > self::limit($kind)) {
            throw fail(413, 'MEDIA_TOO_LARGE');
        }
        try {
            $mime = Sniffer::verify($body, $declared, $kind);
        } catch (MediaException) {
            throw fail(400, 'INVALID_MEDIA');
        }
        if ($mime === 'image/svg+xml' && ! $svg) {
            throw fail(400, 'INVALID_MEDIA');
        }

        return $this->storeMedia($body, $mime);
    }

    /** Raw bytes (request body) with the type in the Content-Type header. */
    public function storeRaw(string $body, string $declared): string
    {
        $mime = strtolower(trim(explode(';', $declared)[0]));
        $kind = $mime === 'image/svg+xml' ? '' : Sniffer::kindOf($mime);
        if ($kind === '' || $body === '') {
            throw fail(400, 'INVALID_MEDIA');
        }
        if (strlen($body) > $this->rawLimit($kind)) {
            throw fail(413, 'MEDIA_TOO_LARGE');
        }
        try {
            $actual = Sniffer::verify($body, $mime, $kind);
        } catch (MediaException) {
            throw fail(400, 'INVALID_MEDIA');
        }

        return $this->storeMedia($body, $actual);
    }

    /** Copies an external https image/video into storage once; MediaException on failure. */
    public function importRemote(string $url, string $kind = 'image'): string
    {
        $key = "$kind:$url";
        if (! isset($this->remoteCache[$key])) {
            $max = $kind === 'video' ? self::limit('video') : min(self::limit('image'), 10 * 1024 * 1024);
            $file = ($this->downloader ?? new RemoteDownloader)->download($url, $kind, $max);
            $this->remoteCache[$key] = $this->storeMedia($file['body'], $file['mime']);
        }

        return $this->remoteCache[$key];
    }

    /**
     * Copy of `$value` where every inline data URL (anywhere) and every external https picture (under a media key) is
     * replaced by its /api/media URL.
     *   remote: 'strict' (failed download rejects the save) | 'lenient' | 'report' (any failure keeps the URL) | 'skip'
     *   known:  strings already stored in the row (kept as they are)
     *
     * @return array{value:mixed,changed:bool}
     */
    public function externalize(mixed $value, string $remote = 'strict', bool $videos = false, bool $svg = true, ?array $known = null): array
    {
        $changed = false;
        $visit = function ($node, string $key, $parent) use (&$visit, &$changed, $remote, $videos, $svg, $known) {
            if (is_string($node)) {
                if (str_starts_with($node, 'data:') && preg_match(self::DATA_URL, $node)) {
                    $changed = true;

                    return $this->storeDataUrl($node, $svg);
                }
                if (preg_match(self::ABSOLUTE, $node, $m)) {
                    $changed = true;

                    return $m[1];
                }
                if ($remote !== 'skip' && in_array($key, self::MEDIA_KEYS, true) && preg_match('#^https?://#i', $node) && ! isset($known[$node])) {
                    $isVideo = $key === 'uri' && $parent instanceof \stdClass && ($parent->type ?? null) === 'video';
                    if ($isVideo && ! $videos) {
                        return $node;
                    }
                    try {
                        $url = $this->importRemote($node, $isVideo ? 'video' : 'image');
                        $changed = true;

                        return $url;
                    } catch (MediaException $e) {
                        if ($remote === 'report' || ($remote === 'lenient' && ! $e->policy)) {
                            return $node;
                        }
                        throw fail($e->policy ? 400 : 502, 'MEDIA_URL_'.$e->errorCode);
                    }
                }

                return $node;
            }
            if (is_array($node)) {
                return array_map(fn ($c) => $visit($c, $key, $parent), $node);
            }
            if ($node instanceof \stdClass) {
                $out = new \stdClass;
                foreach ($node as $k => $child) {
                    $out->{$k} = $visit($child, (string) $k, $node);
                }

                return $out;
            }

            return $node;
        };
        $result = $visit($value, '', null);

        return ['value' => $result, 'changed' => $changed];
    }

    /**
     * Resolve `<hash>.<ext>` to a file. Returns null when unknown. `$width` (320|640) picks a thumbnail when one exists.
     *
     * @return array{path:string,mime:string,size:int,etag:string}|null
     */
    public function locate(string $name, ?int $width = null): ?array
    {
        if (! preg_match(self::NAME, $name, $m)) {
            return null;
        }
        $row = DB::table('media')->where('id', $m[1])->first();
        if (! $row || ! in_array($m[2], [$row->orig_ext, $row->ext], true)) {
            return null;
        }
        $path = self::dir().'/'.$row->id.'.'.$row->ext;
        $mime = $row->mime;
        if ($width && in_array($width, [320, 640], true) && is_file($thumb = self::dir()."/{$row->id}_$width.webp")) {
            $path = $thumb;
            $mime = 'image/webp';
        }
        if (! is_file($path)) {
            return null;
        }

        return ['path' => $path, 'mime' => $mime, 'size' => (int) filesize($path), 'etag' => '"'.$row->id.($width ? "-$width" : '').'"'];
    }
}
