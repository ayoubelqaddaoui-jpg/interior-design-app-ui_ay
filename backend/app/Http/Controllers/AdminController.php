<?php

namespace App\Http\Controllers;

use App\Services\Chat;
use App\Services\Clients;
use App\Services\Content;
use App\Services\Notifier;
use App\Services\Outbox;
use App\Services\Sync;
use App\Services\Translate;
use App\Support\Api;
use App\Support\Body;
use App\Support\Ctx;
use App\Support\Str;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/** Everything under /api/admin except login/session/logout, media and campaigns. Every action needs an admin session. */
class AdminController
{
    private function admin(Request $request): Ctx
    {
        $ctx = Ctx::of($request);
        $ctx->requireAdmin();

        return $ctx;
    }

    public function clients(Request $request, Clients $clients): Response
    {
        $this->admin($request);

        return Api::json(200, $clients->users());
    }

    public function conversations(Request $request, Clients $clients): Response
    {
        $this->admin($request);

        return Api::json(200, $clients->adminConversations());
    }

    public function reply(Request $request, string $id, Clients $clients, Sync $sync, Outbox $outbox): Response
    {
        $this->admin($request);
        $body = Body::read($request);
        $raw = Body::get($body, 'text');
        $text = is_string($raw) ? Str::jsTrim($raw) : '';
        if ($text === '' || Str::jsLength($text) > 4000) {
            throw fail(400, 'INVALID_MESSAGE');
        }
        $message = (object) ['id' => 'a_'.Clients::uuid(), 'role' => 'admin', 'text' => $text, 'createdAt' => now_ms()];
        $result = $clients->adminReply($id, $text, $message);
        // A visitor has no account to notify: their open chat picks the answer up through the sync loop.
        if (! $result['clientId']) {
            $sync->bump('chats', "g:{$result['deviceHash']}");

            return Api::json(200, $result['conversation']);
        }
        $sync->bump("c:{$result['clientId']}", 'chats');
        $job = "reply:{$result['conversation']->id}:{$message->id}";
        $outbox->enqueue('reply', $job, ['id' => $result['conversation']->id, 'text' => $text, 'audience' => ['type' => 'client', 'id' => $result['clientId']]]);
        $outbox->afterResponse($job);

        return Api::json(200, $result['conversation']);
    }

    public function notificationSubscribers(Request $request, Notifier $notifier): Response
    {
        $this->admin($request);

        return Api::json(200, ['adminsEnabled' => $notifier->enabled('admin'), 'usersEnabled' => $notifier->enabled('client'), 'users' => $notifier->clientSubscribers()]);
    }

    public function bulk(Request $request, Clients $clients, Notifier $notifier, Sync $sync): Response
    {
        $this->admin($request);
        $body = Body::read($request);
        $result = $clients->bulk($body);
        $ids = Body::get($body, 'ids');
        if (Body::get($body, 'action') === 'delete') {
            foreach ($ids as $id) {
                $notifier->removeOwner('client', $id);
            }
        }
        $sync->bump('clients', 'requests', ...(is_array($ids) ? array_map(fn ($id) => "c:$id", $ids) : []));

        return Api::json(200, $result);
    }

    public function contentItem(Request $request, string $coll, Content $content, ?string $id = null): Response
    {
        $this->admin($request);
        if ($request->isMethod('PUT') && $id) {
            return Api::json(200, $content->putItem($coll, $id, Body::read($request)));
        }
        if ($request->isMethod('DELETE') && ! $id) {
            $content->deleteItems($coll, Body::get(Body::read($request), 'ids'));

            return Api::json(200, ['ok' => true]);
        }
        throw fail(405, 'Method not allowed');
    }

    public function translate(Request $request, Translate $translate): Response
    {
        $this->admin($request);

        return Api::json(200, $translate->translate(Body::read($request)));
    }

    public function doc(Request $request, string $name, Content $content): Response
    {
        $this->admin($request);

        return Api::json(200, $content->patchDoc($name, Body::read($request)));
    }

    public function client(Request $request, string $id, Clients $clients, Notifier $notifier, Sync $sync): Response
    {
        $this->admin($request);
        if ($request->isMethod('PATCH')) {
            $body = Body::read($request);
            $patch = new \stdClass;
            foreach (['credits', 'blocked'] as $key) {
                if (Body::has($body, $key) && $body->{$key} !== null) {
                    $patch->{$key} = $body->{$key};
                }
            }
            // JSON.stringify drops `undefined`, so a missing field and an explicit null differ only for `null`: keep both as "absent".
            $updated = $clients->update($id, $patch);
            $sync->bump('clients', "c:$id");

            return Api::json(200, $updated);
        }
        if ($request->isMethod('DELETE')) {
            $clients->remove($id);
            $notifier->removeOwner('client', $id);
            $sync->bump('clients', 'requests', "c:$id");

            return Api::json(200, ['ok' => true]);
        }
        throw fail(404, 'API route not found');
    }

    public function chatStatus(Request $request, Chat $chat): Response
    {
        $this->admin($request);

        return Api::json(200, $chat->status());
    }

    public function chatKeys(Request $request, Chat $chat): Response
    {
        $this->admin($request);

        return Api::json(200, $chat->setKeys(Body::read($request)));
    }
}
