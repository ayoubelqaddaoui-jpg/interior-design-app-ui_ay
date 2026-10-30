<?php

namespace App\Http\Controllers;

use App\Services\Chat;
use App\Services\Content;
use App\Support\Api;
use App\Support\Body;
use App\Support\Ctx;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class ChatController
{
    public function reply(Request $request, Content $content, Chat $chat): Response
    {
        $ctx = Ctx::of($request);
        $client = $ctx->client();
        if ($client && $client['blocked']) {
            throw fail(403, 'ACCOUNT_BLOCKED');
        }
        if (! $client && ! $ctx->clientHash()) {
            throw fail(400, 'Client token required');
        }
        $body = Body::read($request);
        $config = $content->getDoc('assistant');
        if (($config->type ?? null) === 'whatsapp') {
            throw fail(409, 'ASSISTANT_DISABLED');
        }

        return Api::json(200, $chat->reply(Body::get($body, 'messages'), $config));
    }
}
