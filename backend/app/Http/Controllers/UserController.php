<?php

namespace App\Http\Controllers;

use App\Services\Clients;
use App\Services\Media;
use App\Services\Outbox;
use App\Services\Sync;
use App\Support\Api;
use App\Support\Body;
use App\Support\Ctx;
use App\Support\Js;
use App\Support\Json;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;

/** Signed-in client's requests, history and conversations, plus the visitor (guest) conversations. */
class UserController
{
    public function requests(Request $request): Response
    {
        $client = Ctx::of($request)->requireUser();
        $rows = [];
        foreach (DB::table('requests')->where('user_id', $client['id'])->orderByDesc('created_at')->pluck('data') as $data) {
            $rows[] = RequestController::publicRow(Json::decode($data));
        }

        return Api::json(200, $rows);
    }

    /** Merge of the stored conversation and the incoming body: `{...existing, ...externalized body}`. */
    private function merged(?\stdClass $existing, mixed $body, Media $media): \stdClass
    {
        return Json::merge($existing, $media->externalize($body, 'report', false, false)['value']);
    }

    private static function find(array $rows, string $id): ?\stdClass
    {
        foreach ($rows as $row) {
            if (($row->id ?? null) === $id) {
                return $row;
            }
        }

        return null;
    }

    public function guest(Request $request, Clients $clients, Media $media, Sync $sync, Outbox $outbox, ?string $id = null): Response
    {
        $ctx = Ctx::of($request);
        if ($ctx->client()) {
            throw fail(409, 'ALREADY_SIGNED_IN');
        }
        $device = $ctx->clientHash();
        if (! $device) {
            throw fail(400, 'Client token required');
        }
        if ($request->isMethod('GET')) {
            $rows = $clients->guestList($device);
            if (! $id) {
                return Api::json(200, $rows);
            }
            $row = self::find($rows, $id);
            if (! $row) {
                throw fail(404, 'NOT_FOUND');
            }

            return Api::json(200, $row);
        }
        if ($request->isMethod('DELETE') && $id) {
            $clients->guestRemove($device, $id);
            $sync->bump('chats', "g:$device");

            return Api::json(200, ['ok' => true]);
        }
        if ($request->isMethod('POST') || ($request->isMethod('PATCH') && $id)) {
            $body = Body::read($request);
            $existing = $id ? self::find($clients->guestList($device), $id) : null;
            if ($id && ! $existing) {
                throw fail(404, 'NOT_FOUND');
            }
            $value = $this->merged($existing, $body, $media);
            $fresh = Js::mergeConversation($value, $existing);
            $saved = $clients->guestPut($device, $value, $id ?: Clients::uuid());
            $sync->bump('chats', "g:$device");
            if (count($fresh)) {
                $last = end($fresh);
                $job = "chat:{$saved->id}:{$last->id}";
                $outbox->enqueue('chat', $job, ['id' => $saved->id, 'name' => '', 'whatsapp' => '', 'text' => $last->text]);
                $outbox->afterResponse($job);
            }

            return Api::json(200, $saved);
        }
        throw fail(405, 'Method not allowed');
    }

    public function space(Request $request, string $kind, Clients $clients, Media $media, Sync $sync, Outbox $outbox, ?string $id = null): Response
    {
        $client = Ctx::of($request)->requireUser();
        if ($request->isMethod('GET')) {
            $rows = $clients->listSpace($client, $kind);
            if (! $id) {
                return Api::json(200, $rows);
            }
            $row = self::find($rows, $id);
            if (! $row) {
                throw fail(404, 'NOT_FOUND');
            }

            return Api::json(200, $row);
        }
        if ($request->isMethod('DELETE') && $id) {
            $clients->removeSpace($client, $kind, $id);
            $sync->bump("c:{$client['id']}", 'clients');

            return Api::json(200, ['ok' => true]);
        }
        if ($request->isMethod('POST') || ($request->isMethod('PATCH') && $id)) {
            $body = Body::read($request);
            $existing = $id ? self::find($clients->listSpace($client, $kind), $id) : null;
            if ($id && ! $existing) {
                throw fail(404, 'NOT_FOUND');
            }
            if ($request->isMethod('POST') && $kind === 'history' && ! $clients->hasClaim(Body::get($body, 'claimId'), $client['id'])) {
                throw fail(403, 'CLAIM_REQUIRED');
            }
            $value = $this->merged($existing, $body, $media);
            if ($kind === 'history' && (! Js::truthy(Js::prop($value->draft ?? null, 'toolId')) || ! is_string($value->before ?? null) || ! in_array($value->status ?? null, ['pending', 'done'], true))) {
                throw fail(400, 'INVALID_HISTORY');
            }
            $fresh = $kind === 'conversations' ? Js::mergeConversation($value, $existing) : [];
            $saved = $clients->putSpace($client, $kind, $value, $id ?: ($kind === 'history' ? Body::get($body, 'claimId') : Clients::uuid()));
            $sync->bump("c:{$client['id']}", 'clients');
            if (count($fresh)) {
                $last = end($fresh);
                $job = "chat:{$saved->id}:{$last->id}";
                $outbox->enqueue('chat', $job, ['id' => $saved->id, 'name' => $client['name'], 'whatsapp' => $client['whatsapp'], 'text' => $last->text]);
                $sync->bump('chats');
                $outbox->afterResponse($job);
            }

            return Api::json(200, $saved);
        }
        throw fail(405, 'Method not allowed');
    }
}
