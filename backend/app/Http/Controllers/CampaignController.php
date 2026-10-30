<?php

namespace App\Http\Controllers;

use App\Services\Campaigns;
use App\Services\CampaignRules;
use App\Services\Notifier;
use App\Support\Api;
use App\Support\Body;
use App\Support\Ctx;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class CampaignController
{
    public function root(Request $request, Campaigns $campaigns): Response
    {
        Ctx::of($request)->requireAdmin();
        if ($request->isMethod('GET')) {
            return Api::json(200, $campaigns->list());
        }
        if ($request->isMethod('POST')) {
            return Api::json(201, $campaigns->create(Body::read($request)));
        }
        throw fail(405, 'Method not allowed');
    }

    public function segments(Request $request, Campaigns $campaigns): Response
    {
        Ctx::of($request)->requireAdmin();
        $num = fn (string $k) => (int) $request->query($k) ?: null;

        return Api::json(200, $campaigns->segments(['newDays' => $num('newDays'), 'inactiveDays' => $num('inactiveDays')]));
    }

    public function preview(Request $request, Campaigns $campaigns): Response
    {
        Ctx::of($request)->requireAdmin();

        return Api::json(200, $campaigns->preview(Body::read($request)));
    }

    public function people(Request $request, Campaigns $campaigns): Response
    {
        Ctx::of($request)->requireAdmin();

        return Api::json(200, $campaigns->people());
    }

    /** Shows the message on THIS admin's own devices, exactly as clients will see it ({name} becomes "Admin"). */
    public function test(Request $request, Notifier $notifier): Response
    {
        Ctx::of($request)->requireAdmin();
        $body = Body::read($request);
        if (! $notifier->count()) {
            throw fail(409, 'NO_SUBSCRIPTION');
        }
        $input = \App\Support\Json::merge($body, (object) ['name' => Body::get($body, 'name') ?: 'test', 'audience' => new \stdClass]);
        $cleaned = CampaignRules::cleanCampaign($input, 'once');
        $result = $notifier->deliver(['id' => 'test', 'name' => 'Admin', 'title' => $cleaned['title'], 'body' => $cleaned['body'], 'url' => $cleaned['url']], [],
            ['event' => 'campaign', 'audience' => ['type' => 'admin'], 'force' => true]);

        return Api::json(200, ['ok' => ! $result['retry'] && $result['sent'] > 0, 'devices' => $result['devices']]);
    }

    public function one(Request $request, string $id, Campaigns $campaigns): Response
    {
        Ctx::of($request)->requireAdmin();
        if (! preg_match('/^[a-f0-9-]{8,64}$/D', $id)) {
            throw fail(404, 'NOT_FOUND');
        }
        if ($request->isMethod('GET')) {
            return Api::json(200, $campaigns->get($id));
        }
        if ($request->isMethod('PATCH')) {
            return Api::json(200, $campaigns->update($id, Body::read($request)));
        }
        if ($request->isMethod('DELETE')) {
            $campaigns->remove($id);

            return Api::json(200, ['ok' => true]);
        }
        throw fail(405, 'Method not allowed');
    }

    public function action(Request $request, string $id, string $action, Campaigns $campaigns): Response
    {
        Ctx::of($request)->requireAdmin();
        if (! preg_match('/^[a-f0-9-]{8,64}$/D', $id)) {
            throw fail(404, 'NOT_FOUND');
        }
        if (! $request->isMethod('POST')) {
            throw fail(405, 'Method not allowed');
        }
        if ($action === 'activate') {
            $result = $campaigns->activate($id);
            // "Send now" must not wait for the next poll: run the scheduler once, bounded.
            $campaigns->tick(true, 8000);

            return Api::json(200, $campaigns->get($result['id']));
        }
        if ($action === 'pause') {
            return Api::json(200, $campaigns->pause($id));
        }
        if ($action === 'duplicate') {
            return Api::json(201, $campaigns->duplicate($id));
        }
        throw fail(404, 'NOT_FOUND');
    }
}
