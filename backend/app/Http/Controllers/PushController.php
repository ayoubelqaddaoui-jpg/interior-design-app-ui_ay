<?php

namespace App\Http\Controllers;

use App\Services\Campaigns;
use App\Services\Notifier;
use App\Services\Outbox;
use App\Support\Api;
use App\Support\Body;
use App\Support\Ctx;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class PushController
{
    public function config(Notifier $notifier): Response
    {
        return Api::json(200, $notifier->config());
    }

    public function subscriptions(Request $request, Notifier $notifier): Response
    {
        $ctx = Ctx::of($request);
        $body = Body::read($request); // read before the auth check, as the Node API did (a bad body answers 400/415 first)
        if (Body::get($body, 'owner') === 'client') {
            $owner = ['type' => 'client', 'id' => $ctx->requireUser()['id']];
        } else {
            $ctx->requireAdmin();
            $owner = ['type' => 'admin', 'id' => $ctx->adminId()];
        }
        try {
            $subscriber = Notifier::validateSubscription($body);
        } catch (\InvalidArgumentException) {
            throw fail(400, 'Invalid subscription');
        }
        if ($request->isMethod('POST')) {
            if ($subscriber['kind'] === 'fcm' && ! $notifier->config()['android']) {
                throw fail(503, 'Push is not configured');
            }
            $notifier->save($subscriber, $owner);
        } elseif ($request->isMethod('DELETE')) {
            $notifier->remove($subscriber['id'], $owner);
        } else {
            throw fail(405, 'Method not allowed');
        }

        return Api::json(200, ['ok' => true]);
    }

    public function test(Request $request, Notifier $notifier): Response
    {
        Ctx::of($request)->requireAdmin();
        if (! $notifier->enabled('admin')) {
            throw fail(409, 'NOTIFICATIONS_OFF');
        }
        $total = $notifier->count();
        if (! $total) {
            throw fail(409, 'NO_SUBSCRIPTION');
        }
        $result = $notifier->deliver(['id' => 'test', 'name' => 'Test', 'whatsapp' => '+212600000000'], []);

        return Api::json(200, ['ok' => ! $result['retry'], 'devices' => $total]);
    }

    /** Retry queue + campaign scheduler trigger for an HTTP cron service (`Authorization: Bearer $CRON_SECRET`) or an admin session. */
    public function pump(Request $request, Outbox $outbox, Campaigns $campaigns): Response
    {
        $ctx = Ctx::of($request);
        $secret = (string) config('dwira.cron_secret');
        $bearer = $request->headers->get('Authorization');
        if (! $ctx->adminSession() && ! ($secret !== '' && is_string($bearer) && hash_equals("Bearer $secret", $bearer))) {
            throw fail(401, 'Admin login required');
        }
        $outbox->pump(null, 20000);
        $ran = $campaigns->tick(true, 20000);

        return Api::json(200, ['ok' => true, 'campaigns' => ! empty($ran) && empty($ran['skipped']) ? ! empty($ran['ok']) : null]);
    }
}
