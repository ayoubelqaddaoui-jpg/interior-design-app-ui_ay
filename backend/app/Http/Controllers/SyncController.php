<?php

namespace App\Http\Controllers;

use App\Services\Campaigns;
use App\Services\Outbox;
use App\Services\Sync;
use App\Support\Api;
use App\Support\Ctx;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Cache;

class SyncController
{
    /**
     * The polling endpoint (every open app calls it every few seconds). Cost for an anonymous visitor: ONE indexed
     * query. Signed-in callers add their session lookup. Background work (retry of failed pushes, the campaign scheduler) runs
     * after the response is sent and at most once per 10 s for the whole site (shared gate), not once per poll.
     */
    public function __invoke(Request $request, Sync $sync, Outbox $outbox, Campaigns $campaigns): Response
    {
        $ctx = Ctx::of($request);
        $session = $ctx->adminSession();
        $client = $ctx->client();
        $device = $ctx->clientHash();
        $adminId = $session?->admin_id;
        $keys = ['content'];
        if ($session) {
            array_push($keys, 'requests', 'clients', 'chats', 'campaigns', "a:$adminId");
        }
        if ($client) {
            $keys[] = "c:{$client['id']}";
        }
        if ($device && ! $client) {
            $keys[] = "g:$device";
        }
        $v = $sync->read($keys);

        app()->terminating(function () use ($outbox, $campaigns) {
            try {
                if (! Cache::add('dwira:background', 1, 10)) {
                    return;
                }
                if ($outbox->hasDue()) {
                    $outbox->pump(null, 9000);
                }
                $campaigns->tick(false, 6000);
            } catch (\Throwable) {
            }
        });

        return Api::json(200, [
            'content' => $v['content'],
            'campaigns' => $session ? $v['campaigns'] : null,
            'requests' => $session ? $v['requests'] : null,
            'clients' => $session ? $v['clients'] : null,
            'chats' => $session ? $v['chats'] : null,
            'admin' => $session ? $v["a:$adminId"] : null,
            'client' => $client ? $v["c:{$client['id']}"] : null,
            'guest' => $device && ! $client ? $v["g:$device"] : null,
            'user' => $client ? ['id' => $client['id'], 'blocked' => (bool) $client['blocked']] : null,
            'isAdmin' => (bool) $session,
        ]);
    }
}
