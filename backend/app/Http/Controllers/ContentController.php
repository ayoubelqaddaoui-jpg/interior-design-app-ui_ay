<?php

namespace App\Http\Controllers;

use App\Services\Content;
use App\Support\Api;
use App\Support\Ctx;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class ContentController
{
    /**
     * Public catalogue. The body comes from a cache keyed by the content version (1 query to validate); the browser and a CDN
     * revalidate with a weak ETag derived from the same version, so an unchanged catalogue costs one query and no body.
     * The admin copy (contains provider API keys) and any admin-panel request (`?a`) are never cached or tagged.
     */
    public function show(Request $request, Content $content): Response
    {
        $ctx = Ctx::of($request);
        $adminAsked = $ctx->sessionToken() !== null || $request->query->has('a');
        $isAdmin = $ctx->sessionToken() !== null && $ctx->adminSession() !== null;
        $snapshot = $content->snapshotJson($isAdmin);
        $maxAge = (int) config('dwira.content_s_maxage', 30);
        if ($adminAsked) {
            return Api::raw(200, $snapshot['json'], ['Cache-Control' => 'private, no-store']);
        }
        $etag = 'W/"content-'.$snapshot['version'].'"';
        $cache = $maxAge > 0 ? "public, max-age=0, s-maxage=$maxAge, stale-while-revalidate=".($maxAge * 10) : 'no-cache';
        $headers = ['Cache-Control' => $cache, 'ETag' => $etag];
        if (self::matches($request->headers->get('If-None-Match'), $etag)) {
            return new Response('', 304, $headers);
        }

        return Api::raw(200, $snapshot['json'], $headers);
    }

    /** `If-None-Match` comparison ignoring the weak prefix and the `-gzip` suffix Apache's mod_deflate may add. */
    public static function matches(?string $header, string $etag): bool
    {
        if ($header === null || $header === '') {
            return false;
        }
        $norm = fn (string $t) => preg_replace('/-(gzip|br)"$/', '"', preg_replace('/^W\//', '', trim($t)));
        foreach (explode(',', $header) as $candidate) {
            if (trim($candidate) === '*' || $norm($candidate) === $norm($etag)) {
                return true;
            }
        }

        return false;
    }
}
