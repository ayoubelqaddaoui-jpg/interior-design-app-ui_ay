<?php

namespace App\Http\Controllers;

use App\Services\Content;
use App\Services\Media;
use App\Services\Media\MediaException;
use App\Support\Api;
use App\Support\Body;
use App\Support\Ctx;
use App\Support\Str;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

class MediaController
{
    /**
     * `/api/media/<hash>.<ext>`: content-addressed, so the bytes behind a name never change -> immutable for a year.
     * `?w=320|640` returns a WebP thumbnail when one exists (the app may ask for it; the original URL always works).
     * Videos support byte ranges (BinaryFileResponse), so seeking works.
     */
    public function show(Request $request, Media $media, Content $content, string $name): BinaryFileResponse|Response
    {
        $content->ensureSeed(); // the seed catalogue references media that is created on first use
        $width = (int) $request->query('w') ?: null;
        $file = $media->locate($name, $width);
        if (! $file) {
            throw fail(404, 'NOT_FOUND');
        }
        if (self::matchesEtag($request->headers->get('If-None-Match'), $file['etag'])) {
            return new Response('', 304, ['ETag' => $file['etag'], 'Cache-Control' => 'public, max-age=31536000, s-maxage=31536000, immutable']);
        }
        $response = new BinaryFileResponse($file['path'], 200, [], false);
        $response->headers->set('Content-Type', $file['mime']);
        $response->headers->set('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
        $response->headers->set('ETag', $file['etag']);
        $response->headers->set('Accept-Ranges', 'bytes');
        if ($file['mime'] === 'image/svg+xml') {
            $response->headers->set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
        }
        $response->prepare($request);

        return $response;
    }

    private static function matchesEtag(?string $header, string $etag): bool
    {
        if ($header === null) {
            return false;
        }
        foreach (explode(',', $header) as $candidate) {
            if (trim($candidate) === '*' || preg_replace('/^W\//', '', trim($candidate)) === $etag) {
                return true;
            }
        }

        return false;
    }

    /** Small files picked in the admin: JSON `{ data: "data:<type>;base64,..." }` -> `{ url }`. */
    public function upload(Request $request, Media $media): Response
    {
        Ctx::of($request)->requireAdmin();
        $body = Body::read($request);
        $data = Body::get($body, 'data');
        if (! is_string($data) || ! preg_match('#^data:[a-z]+/[a-z0-9.+-]+;base64,#i', $data)) {
            throw fail(400, 'INVALID_MEDIA');
        }

        return Api::json(200, ['url' => $media->externalize((object) ['file' => $data])['value']->file]);
    }

    /** Raw upload: the file is the request body, its type the Content-Type (what `src/lib/media.ts` sends). */
    public function raw(Request $request, Media $media): Response
    {
        Ctx::of($request)->requireAdmin();
        $type = strtolower(trim(explode(';', (string) $request->headers->get('Content-Type', ''))[0]));
        $max = $media->rawLimit(str_starts_with($type, 'video/') ? 'video' : 'image');
        $declared = (int) $request->headers->get('Content-Length', 0);
        if ($declared > $max) {
            throw fail(413, 'MEDIA_TOO_LARGE');
        }
        $bytes = $request->getContent();
        if (strlen($bytes) > $max) {
            throw fail(413, 'MEDIA_TOO_LARGE');
        }

        return Api::json(200, ['url' => $media->storeRaw($bytes, $type)]);
    }

    /** External image URL -> downloaded once into storage (https, public hosts, 10 s, 10 MB, image only). */
    public function import(Request $request, Media $media): Response
    {
        Ctx::of($request)->requireAdmin();
        $url = Body::get(Body::read($request), 'url');
        if (! is_string($url) || Str::jsLength($url) > 2048) {
            throw fail(400, 'INVALID_URL');
        }
        try {
            return Api::json(200, ['url' => $media->importRemote($url)]);
        } catch (MediaException $e) {
            throw fail($e->policy ? 400 : 502, 'MEDIA_URL_'.$e->errorCode);
        }
    }

    /**
     * No object storage here: files live on this server's disk. `presign` answers the code the frontend already understands
     * (`R2_NOT_CONFIGURED`) and `src/lib/media.ts` then falls back to the raw upload above - no frontend change needed.
     */
    public function presign(Request $request): Response
    {
        Ctx::of($request)->requireAdmin();
        Body::read($request);
        throw fail(503, 'R2_NOT_CONFIGURED');
    }

    public function complete(Request $request): Response
    {
        Ctx::of($request)->requireAdmin();
        Body::read($request);
        throw fail(503, 'R2_NOT_CONFIGURED');
    }
}
