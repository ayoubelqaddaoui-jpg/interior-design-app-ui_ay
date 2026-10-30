<?php

namespace App\Http\Controllers;

use App\Services\Content;
use App\Support\Api;
use App\Support\Body;
use App\Support\Ctx;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class PrefsController
{
    public function __invoke(Request $request, Content $content): Response
    {
        $ctx = Ctx::of($request);
        $asAdmin = $request->query('as') === 'admin';
        if ($asAdmin) {
            $ctx->requireAdmin();
        } else {
            $ctx->requireUser();
        }
        if ($request->isMethod('GET')) {
            return Api::json(200, $asAdmin ? $content->adminPrefs($ctx->adminId()) : $content->clientPrefs($ctx->client()['id']));
        }
        if ($request->isMethod('PATCH')) {
            $body = Body::read($request);

            return Api::json(200, $asAdmin ? $content->setAdminPrefs($ctx->adminId(), $body) : $content->setClientPrefs($ctx->client()['id'], $body));
        }
        throw fail(405, 'Method not allowed');
    }
}
