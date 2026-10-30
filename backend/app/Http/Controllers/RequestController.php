<?php

namespace App\Http\Controllers;

use App\Services\Clients;
use App\Services\Db as Tx;
use App\Services\Media;
use App\Services\Notifier;
use App\Services\Outbox;
use App\Services\Sync;
use App\Support\Api;
use App\Support\Body;
use App\Support\Ctx;
use App\Support\Js;
use App\Support\Json;
use App\Support\Str;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;

/** Render requests (a client's demand for a design). Same rules, order of checks and JSON as server/index.js. */
class RequestController
{
    /** `{ clientHash, clientRequestId, ...row }` -> row. */
    public static function publicRow(\stdClass $row): \stdClass
    {
        $out = clone $row;
        unset($out->clientHash, $out->clientRequestId);

        return $out;
    }

    private static function validateDemand(array $client, \stdClass $body): \stdClass
    {
        $name = Notifier::trim($client['name'], 120);
        $whatsapp = Notifier::phone($client['whatsapp']);
        if (Str::jsLength($name) < 2 || ! preg_match('/^\+?\d{6,20}$/D', $whatsapp)) {
            throw fail(400, 'Name and phone required');
        }
        $photo = $body->photoUri ?? null;
        if (! is_string($photo) || Str::jsLength($photo) > 3000000
            || ! preg_match('#^(data:image/(png|jpeg|webp);base64,|https?://|/api/media/[a-f0-9]{32}\.[a-z0-9]+$)#D', $photo)) {
            throw fail(400, 'Invalid photo');
        }
        $draft = new \stdClass;
        $source = $body->draft ?? null;
        foreach (['toolId', 'roomTypeId', 'styleId', 'paletteId', 'modelId', 'mode'] as $key) {
            if ($source instanceof \stdClass && isset($source->{$key})) {
                if (! is_string($source->{$key}) || Str::jsLength($source->{$key}) > 100) {
                    throw fail(400, 'Invalid draft');
                }
                $draft->{$key} = $source->{$key};
            }
        }
        if (! Js::truthy($draft->toolId ?? null)) {
            throw fail(400, 'Tool required');
        }

        return (object) ['name' => $name, 'whatsapp' => $whatsapp, 'draft' => $draft, 'photoUri' => $photo,
            'userId' => $client['id'], 'status' => 'pending', 'createdAt' => now_ms()];
    }

    public function create(Request $request, Media $media, Clients $clients, Sync $sync, Outbox $outbox): Response
    {
        $ctx = Ctx::of($request);
        $device = $ctx->clientHash();
        if (! $device) {
            throw fail(400, 'Client token required');
        }
        $client = $ctx->requireUser();
        $body = Body::read($request);
        if (! ($body instanceof \stdClass)) {
            throw fail(500, 'Server error');
        }
        $input = self::validateDemand($client, $body);
        $id = $body->id ?? null;
        if (! is_string($id) || ! preg_match('/^[A-Za-z0-9_-]{8,100}$/D', $id)) {
            throw fail(400, 'Stable request ID required');
        }
        $clients->claim($client, $id);
        // The photo becomes a media file; the row keeps only its /api/media URL. A retry of a known request skips this work.
        $known = DB::table('requests')->where('user_id', $client['id'])->where('client_request_id', $id)->exists();
        if (! $known) {
            $input->photoUri = $media->externalize((object) ['photoUri' => $input->photoUri], 'report', false, false)['value']->photoUri;
        }
        $request_ = Json::merge($input, (object) ['id' => Clients::uuid(), 'clientHash' => $device, 'clientRequestId' => $id]);
        $inserted = Tx::insertIfAbsent('requests', ['id' => $request_->id, 'user_id' => $client['id'], 'client_request_id' => $id,
            'created_at' => $request_->createdAt, 'data' => Json::encode($request_)]);
        if ($inserted) {
            $outbox->enqueue('request', $request_->id);
            $sync->bump('requests', 'clients', "c:{$client['id']}");
        }
        $stored = Json::decode((string) DB::table('requests')->where('user_id', $client['id'])->where('client_request_id', $id)->value('data'));
        if ($inserted) {
            $outbox->afterResponse($request_->id);
        }

        return Api::json(201, self::publicRow($stored));
    }

    public function index(Request $request, Outbox $outbox): Response
    {
        Ctx::of($request)->requireAdmin();
        $outbox->afterResponseIfDue();
        $rows = [];
        foreach (DB::table('requests')->orderByDesc('created_at')->pluck('data') as $data) {
            $rows[] = self::publicRow(Json::decode($data));
        }

        return Api::json(200, $rows);
    }

    public function one(Request $request, string $id, Media $media, Clients $clients, Sync $sync, Outbox $outbox): Response
    {
        $ctx = Ctx::of($request);
        $found = DB::table('requests')->where('id', $id)->value('data');
        $row = $found === null ? null : Json::decode($found);
        $session = $ctx->adminSession();
        if (! $row || (! $session && (! $ctx->client() || ($row->userId ?? null) !== $ctx->client()['id']))) {
            throw fail(404, 'Not found');
        }
        if ($request->isMethod('GET')) {
            return Api::json(200, self::publicRow($row));
        }
        if ($request->isMethod('DELETE')) {
            $ctx->requireAdmin();
            DB::table('outbox')->where('request_id', $row->id)->delete();
            DB::table('requests')->where('id', $row->id)->delete();
            $sync->bump('requests', "c:{$row->userId}");

            return Api::json(200, ['ok' => true]);
        }
        if ($request->isMethod('PATCH')) {
            return $this->patch($request, $row, (bool) $session, $media, $clients, $sync, $outbox);
        }
        throw fail(404, 'API route not found');
    }

    private function patch(Request $request, \stdClass $row, bool $admin, Media $media, Clients $clients, Sync $sync, Outbox $outbox): Response
    {
        $body = Body::read($request);
        $patch = new \stdClass;
        $fields = $admin ? ['status', 'autoSent', 'aiResult', 'finalResult', 'historyId'] : ['aiResult', 'historyId'];
        foreach ($fields as $field) {
            $value = Body::get($body, $field);
            if ($value === null) {
                continue;
            }
            if ($field === 'status') {
                if (! in_array($value, ['pending', 'processing', 'delivered'], true)) {
                    throw fail(400, 'Invalid status');
                }
            } elseif ($field === 'autoSent') {
                if (! is_bool($value)) {
                    throw fail(400, 'Invalid value');
                }
            } elseif (! is_string($value) || Str::jsLength($value) > 3000000) {
                throw fail(400, 'Invalid value');
            }
            $patch->{$field} = $value;
        }
        // AI results and final designs (data URLs or provider/CDN URLs) are copied into media storage.
        $patch = Json::merge($patch, $media->externalize($patch, 'report', false, false)['value']);
        // The client's own auto-send workflow may only mark its own completed render.
        if (! $admin && Body::get($body, 'status') === 'delivered' && Body::get($body, 'autoSent') === true && Js::truthy(Body::get($body, 'aiResult'))) {
            $patch->status = 'delivered';
            $patch->autoSent = true;
        }
        $wasDelivered = false;
        $result = Tx::tx(function () use ($row, $patch, &$wasDelivered) {
            $current = Json::decode((string) DB::table('requests')->where('id', $row->id)->lockForUpdate()->value('data'));
            $wasDelivered = ($current->status ?? null) === 'delivered';
            $next = Json::merge($current, $patch);
            DB::table('requests')->where('id', $row->id)->update(['data' => Json::encode($next)]);

            return $next;
        });
        $sync->bump('requests', "c:{$result->userId}");
        // The admin delivered the final design: tell its owner on every device they enabled notifications on.
        if ($admin && ($result->status ?? null) === 'delivered' && ! $wasDelivered) {
            $job = "ready:{$result->id}";
            $outbox->enqueue('ready', $job, ['id' => $result->id, 'name' => $result->name ?? null, 'whatsapp' => $result->whatsapp ?? null,
                'audience' => ['type' => 'client', 'id' => $result->userId]]);
            $outbox->afterResponse($job);
        }
        if (($result->status ?? null) === 'delivered' && Js::truthy($result->historyId ?? null) && (Js::truthy($result->finalResult ?? null) || Js::truthy($result->aiResult ?? null))) {
            $owner = $clients->user($result->userId);
            $item = null;
            if ($owner) {
                foreach ($clients->listSpace($owner, 'history') as $h) {
                    if (($h->id ?? null) === $result->historyId) {
                        $item = $h;
                        break;
                    }
                }
            }
            if ($item) {
                $after = Js::truthy($result->finalResult ?? null) ? $result->finalResult : $result->aiResult;
                $clients->putSpace($owner, 'history', Json::merge($item, (object) ['after' => $after, 'status' => 'done']), $item->id);
            }
        }

        return Api::json(200, self::publicRow($result));
    }
}
