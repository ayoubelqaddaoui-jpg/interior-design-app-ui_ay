<?php

namespace App\Services;

use App\Support\Json;
use App\Support\Str;
use Illuminate\Support\Facades\DB;

/** Phone-based client profiles, sessions, free/paid entitlement claims and per-client history/chat space (server/clients.js). */
final class Clients
{
    public const MAX_CREDITS = 1000000;
    private const MAX_GUEST_CHATS = 30;

    /** JS `String(input || '')` for the values a JSON body can hold. */
    private static function jsString(mixed $v): string
    {
        if ($v === null || $v === false || $v === 0 || $v === 0.0 || $v === '') {
            return '';
        }
        if (is_string($v)) {
            return $v;
        }
        if (is_int($v) || is_float($v)) {
            return (string) $v;
        }

        return $v === true ? 'true' : '[object Object]';
    }

    public static function canonicalPhone(mixed $input): string
    {
        $phone = self::jsString($input);
        $phone = preg_replace('/[\s().\-]/u', '', $phone) ?? $phone;
        $phone = preg_replace('/^00/', '+', $phone) ?? $phone;
        if (preg_match('/^0[5-7]\d{8}$/D', $phone)) {
            $phone = '212'.substr($phone, 1);
        }

        return '+'.preg_replace('/^\+/', '', $phone);
    }

    /**
     * A client who has not used the free design is shown `credits + 1`. To make the balance an admin types equal the balance
     * the user sees, a target of 0 also consumes the unused free design; any other target keeps it and stores the remainder.
     *
     * @return array{credits:int,freeUsed:int}
     */
    public static function balance(int $freeUsed, int $shown): array
    {
        return ! $freeUsed && $shown <= 0 ? ['credits' => 0, 'freeUsed' => 1] : ['credits' => max(0, $shown - ($freeUsed ? 0 : 1)), 'freeUsed' => $freeUsed];
    }

    public static function toUser(?object $row): ?array
    {
        if (! $row) {
            return null;
        }

        return ['id' => $row->id, 'name' => $row->name, 'whatsapp' => $row->phone, 'credits' => (int) $row->credits + ($row->free_used ? 0 : 1),
            'freeUsed' => (int) $row->free_used, 'leadDone' => true, 'role' => 'user', 'blocked' => (bool) $row->blocked, 'createdAt' => (int) $row->created_at];
    }

    private static function isSafeInt(mixed $v): bool
    {
        return (is_int($v) && abs($v) <= 9007199254740991) || (is_float($v) && floor($v) === $v && abs($v) <= 9007199254740991);
    }

    private function byId(string $id, bool $lock = false): ?object
    {
        $q = DB::table('clients')->where('id', $id);

        return ($lock ? $q->lockForUpdate() : $q)->first();
    }

    /** @return array{token:string,user:array,created:bool} */
    public function login(mixed $name, mixed $phone, mixed $defaultCredits = 1): array
    {
        $canonical = self::canonicalPhone($phone);
        if (! preg_match('/^\+[1-9]\d{5,14}$/D', $canonical) || ! is_string($name) || Str::jsLength(Str::jsTrim($name)) < 2 || Str::jsLength($name) > 120) {
            throw fail(400, 'INVALID_PROFILE');
        }
        // The admin's "default credits" setting is the balance a new client starts with (free design included).
        $start = self::balance(0, self::isSafeInt($defaultCredits) && $defaultCredits >= 0 ? (int) min($defaultCredits, self::MAX_CREDITS) : 1);
        // Atomic: the UNIQUE phone key means two simultaneous first logins cannot create two profiles.
        $created = Db::insertIfAbsent('clients', ['id' => self::uuid(), 'phone' => $canonical, 'name' => Str::jsTrim($name), 'created_at' => now_ms(), 'credits' => $start['credits'], 'free_used' => $start['freeUsed']]);
        $row = DB::table('clients')->where('phone', $canonical)->first();
        if ($row->blocked) {
            throw fail(403, 'ACCOUNT_BLOCKED');
        }
        $token = bin2hex(random_bytes(32));
        DB::table('user_sessions')->where('expires_at', '<=', now_ms())->delete();
        DB::table('user_sessions')->insert(['token_hash' => Str::sha256($token), 'client_id' => $row->id, 'expires_at' => now_ms() + 365 * 86400000]);
        DB::table('clients')->where('id', $row->id)->update(['last_seen' => now_ms()]);

        return ['token' => $token, 'user' => self::toUser($row), 'created' => $created];
    }

    public function authenticate(?string $token): ?array
    {
        if (! $token || ! preg_match('/^[a-f0-9]{64}$/D', $token)) {
            return null;
        }
        $row = DB::table('user_sessions as s')->join('clients as c', 'c.id', '=', 's.client_id')
            ->where('s.token_hash', Str::sha256($token))->where('s.expires_at', '>', now_ms())->select('c.*')->first();
        // Activity for notification segments, written at most every 5 minutes (the sync poll only runs while the app is visible).
        if ($row && now_ms() - (int) ($row->last_seen ?? 0) > 300000) {
            try {
                DB::table('clients')->where('id', $row->id)->update(['last_seen' => now_ms()]);
            } catch (\Throwable) {
            }
        }

        return self::toUser($row);
    }

    /** Idempotent: replaying the same claim id never charges twice; the first free claim is atomic. */
    public function claim(array $client, mixed $id): array
    {
        if (! is_string($id) || ! preg_match('/^[A-Za-z0-9_-]{8,100}$/D', $id)) {
            throw fail(400, 'INVALID_CLAIM');
        }

        return Db::tx(function () use ($client, $id) {
            $this->byId($client['id'], true); // serialises concurrent claims per client
            $old = DB::table('claims')->where('id', $id)->first();
            if ($old) {
                if ($old->client_id !== $client['id']) {
                    throw fail(409, 'INVALID_CLAIM');
                }

                return self::toUser($this->byId($client['id']));
            }
            $row = $this->byId($client['id']);
            if (! $row) {
                throw fail(401, 'USER_LOGIN_REQUIRED');
            }
            if ($row->blocked) {
                throw fail(403, 'ACCOUNT_BLOCKED');
            }
            $free = ! $row->free_used;
            if (! $free && $row->credits <= 0) {
                throw fail(402, 'PRO_REQUIRED');
            }
            if ($free) {
                DB::table('clients')->where('id', $client['id'])->update(['free_used' => 1]);
            } else {
                DB::table('clients')->where('id', $client['id'])->decrement('credits');
            }
            DB::table('claims')->insert(['id' => $id, 'client_id' => $client['id'], 'free' => $free ? 1 : 0, 'created_at' => now_ms()]);

            return self::toUser($this->byId($client['id']));
        });
    }

    public function hasClaim(mixed $id, string $clientId): bool
    {
        return is_string($id) && DB::table('claims')->where('id', $id)->where('client_id', $clientId)->exists();
    }

    public function user(string $id): ?array
    {
        return self::toUser($this->byId($id));
    }

    public function logout(?string $token): void
    {
        if ($token) {
            DB::table('user_sessions')->where('token_hash', Str::sha256($token))->delete();
        }
    }

    /** @return list<array> */
    public function users(): array
    {
        return array_map(fn ($r) => self::toUser($r), DB::table('clients')->orderByDesc('created_at')->get()->all());
    }

    /* ---- history / conversations of a signed-in client ---- */

    /** @return list<\stdClass> */
    public function listSpace(array $client, string $kind): array
    {
        $out = [];
        foreach (DB::table('space')->where('client_id', $client['id'])->where('kind', $kind)->orderBy('seq')->pluck('value') as $value) {
            $out[] = Json::decode($value);
        }

        return $out;
    }

    public function putSpace(array $client, string $kind, \stdClass $value, string $id): \stdClass
    {
        $existing = DB::table('space')->select('client_id', 'kind')->where('id', $id)->first();
        if ($existing && ($existing->client_id !== $client['id'] || $existing->kind !== $kind)) {
            throw fail(404, 'NOT_FOUND');
        }
        $next = Json::merge($value, (object) ['id' => $id, 'userId' => $client['id']]);
        DB::statement('INSERT INTO space(id, client_id, kind, value) VALUES(?, ?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)', [$id, $client['id'], $kind, Json::encode($next)]);

        return $next;
    }

    public function removeSpace(array $client, string $kind, string $id): void
    {
        DB::table('space')->where('id', $id)->where('client_id', $client['id'])->where('kind', $kind)->delete();
    }

    /** Admin view of every conversation: clients' (with who wrote it) and visitors' (`guest: true`, no name or phone). */
    public function adminConversations(): array
    {
        $rows = [];
        foreach (DB::select("SELECT s.value, c.name, c.phone FROM space s JOIN clients c ON c.id = s.client_id WHERE s.kind = 'conversations'") as $r) {
            $rows[] = Json::merge(Json::decode($r->value), (object) ['clientName' => $r->name, 'whatsapp' => $r->phone]);
        }
        foreach (DB::select('SELECT value FROM guest_chats ORDER BY updated_at DESC LIMIT 300') as $r) {
            $rows[] = Json::merge(Json::decode($r->value), (object) ['clientName' => '', 'whatsapp' => '', 'guest' => true]);
        }
        $rows = array_values(array_filter($rows, fn ($r) => isset($r->messages) && is_array($r->messages) && count($r->messages)));
        usort($rows, fn ($a, $b) => self::num($b->updatedAt ?? 0) <=> self::num($a->updatedAt ?? 0));

        return array_slice($rows, 0, 300);
    }

    /** JS `x || 0` followed by arithmetic. */
    public static function num(mixed $v): float
    {
        return is_numeric($v) ? (float) $v : 0.0;
    }

    /** @return array{conversation:\stdClass,clientId:?string,deviceHash?:string} */
    public function adminReply(string $id, string $text, \stdClass $message): array
    {
        $row = DB::selectOne("SELECT s.client_id, s.value, c.name, c.phone FROM space s JOIN clients c ON c.id = s.client_id WHERE s.id = ? AND s.kind = 'conversations'", [$id]);
        if (! $row) {
            $guest = DB::table('guest_chats')->select('device_hash', 'value')->where('id', $id)->first();
            if (! $guest) {
                throw fail(404, 'NOT_FOUND');
            }
            $value = Json::decode($guest->value);
            $next = Json::merge($value, (object) ['messages' => [...($value->messages ?? []), $message], 'updatedAt' => $message->createdAt]);
            DB::table('guest_chats')->where('id', $id)->update(['value' => Json::encode($next), 'updated_at' => $message->createdAt]);

            return ['conversation' => Json::merge($next, (object) ['clientName' => '', 'whatsapp' => '', 'guest' => true]), 'clientId' => null, 'deviceHash' => $guest->device_hash];
        }
        $value = Json::decode($row->value);
        $next = Json::merge($value, (object) ['messages' => [...($value->messages ?? []), $message], 'updatedAt' => $message->createdAt]);
        DB::table('space')->where('id', $id)->update(['value' => Json::encode($next)]);

        return ['conversation' => Json::merge($next, (object) ['clientName' => $row->name, 'whatsapp' => $row->phone]), 'clientId' => $row->client_id];
    }

    /* ---- visitors who have not signed in: chats live under the hashed device token ---- */

    /** @return list<\stdClass> */
    public function guestList(string $device): array
    {
        return array_map(fn ($v) => Json::decode($v), DB::table('guest_chats')->where('device_hash', $device)->orderByDesc('updated_at')->pluck('value')->all());
    }

    public function guestPut(string $device, \stdClass $value, string $id): \stdClass
    {
        $existing = DB::table('guest_chats')->select('device_hash')->where('id', $id)->first();
        if ($existing && $existing->device_hash !== $device) {
            throw fail(404, 'NOT_FOUND');
        }
        // An id that belongs to a signed-in client's own thread is never writable from a device token.
        if (! $existing && DB::table('space')->where('id', $id)->exists()) {
            throw fail(404, 'NOT_FOUND');
        }
        if (! $existing && DB::table('guest_chats')->where('device_hash', $device)->count() >= self::MAX_GUEST_CHATS) {
            throw fail(429, 'TOO_MANY_CHATS');
        }
        $next = Json::merge($value, (object) ['id' => $id, 'userId' => 'guest']);
        $updated = isset($next->updatedAt) && is_numeric($next->updatedAt) && (float) $next->updatedAt != 0 ? (int) $next->updatedAt : now_ms();
        DB::statement('INSERT INTO guest_chats(id, device_hash, value, updated_at) VALUES(?, ?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)', [$id, $device, Json::encode($next), $updated]);

        return $next;
    }

    public function guestRemove(string $device, string $id): void
    {
        DB::table('guest_chats')->where('id', $id)->where('device_hash', $device)->delete();
    }

    /** The visitor signed in: every conversation this device started now belongs to the client (one transaction). @return list<string> */
    public function adoptGuest(?string $device, array $client): array
    {
        if (! $device) {
            return [];
        }

        return Db::tx(function () use ($device, $client) {
            $rows = DB::table('guest_chats')->select('id', 'value')->where('device_hash', $device)->lockForUpdate()->get();
            foreach ($rows as $row) {
                $next = Json::merge(Json::decode($row->value), (object) ['userId' => $client['id']]);
                Db::insertIfAbsent('space', ['id' => $row->id, 'client_id' => $client['id'], 'kind' => 'conversations', 'value' => Json::encode($next)]);
                DB::table('guest_chats')->where('id', $row->id)->delete();
            }

            return $rows->pluck('id')->all();
        });
    }

    /* ---- admin edits ---- */

    /** Admin edit of one client. Only whitelisted fields; credits are the displayed balance (free design included). */
    public function update(string $id, \stdClass $patch): array
    {
        $hasCredits = property_exists($patch, 'credits');
        $hasBlocked = property_exists($patch, 'blocked');
        if ($hasCredits && (! self::isSafeInt($patch->credits) || $patch->credits < 0 || $patch->credits > self::MAX_CREDITS)) {
            throw fail(400, 'INVALID_CREDITS');
        }
        if ($hasBlocked && ! is_bool($patch->blocked)) {
            throw fail(400, 'INVALID_BLOCKED');
        }

        return Db::tx(function () use ($id, $patch, $hasCredits, $hasBlocked) {
            $row = $this->byId($id, true);
            if (! $row) {
                throw fail(404, 'NOT_FOUND');
            }
            if ($hasCredits) {
                $next = self::balance((int) $row->free_used, (int) $patch->credits);
                DB::table('clients')->where('id', $id)->update(['credits' => $next['credits'], 'free_used' => $next['freeUsed']]);
            }
            if ($hasBlocked) {
                DB::table('clients')->where('id', $id)->update(['blocked' => $patch->blocked ? 1 : 0]);
            }

            return self::toUser($this->byId($id));
        });
    }

    /**
     * Bulk action on many clients in ONE transaction (all or nothing): block | unblock | delete | credits(mode set|add|subtract, amount).
     *
     * @return array{affected:int,users:list<array>}
     */
    public function bulk(mixed $body): array
    {
        $ids = $body->ids ?? null;
        $action = $body->action ?? null;
        $mode = $body->mode ?? null;
        $amount = $body->amount ?? null;
        if (! is_array($ids) || ! count($ids) || count($ids) > 500 || array_filter($ids, fn ($i) => ! is_string($i) || ! preg_match('/^[a-f0-9-]{8,64}$/D', $i))) {
            throw fail(400, 'INVALID_IDS');
        }
        if (! in_array($action, ['block', 'unblock', 'delete', 'credits'], true)) {
            throw fail(400, 'INVALID_ACTION');
        }
        if ($action === 'credits' && (! in_array($mode, ['set', 'add', 'subtract'], true) || ! self::isSafeInt($amount) || $amount < 0 || $amount > self::MAX_CREDITS)) {
            throw fail(400, 'INVALID_CREDITS');
        }
        $unique = array_values(array_unique($ids));
        sort($unique, SORT_STRING); // stable lock order avoids deadlocks between concurrent bulk calls

        return Db::tx(function () use ($unique, $action, $mode, $amount) {
            $rows = [];
            foreach ($unique as $id) {
                $row = $this->byId($id, true);
                if ($row) {
                    $rows[] = $row;
                }
            }
            foreach ($rows as $row) {
                if ($action === 'delete') {
                    DB::table('clients')->where('id', $row->id)->delete();
                } elseif ($action === 'block' || $action === 'unblock') {
                    DB::table('clients')->where('id', $row->id)->update(['blocked' => $action === 'block' ? 1 : 0]);
                } else {
                    $shown = (int) $row->credits + ($row->free_used ? 0 : 1);
                    $next = (int) min(self::MAX_CREDITS, max(0, $mode === 'set' ? $amount : ($mode === 'add' ? $shown + $amount : $shown - $amount)));
                    $stored = self::balance((int) $row->free_used, $next);
                    DB::table('clients')->where('id', $row->id)->update(['credits' => $stored['credits'], 'free_used' => $stored['freeUsed']]);
                }
            }
            $users = [];
            if ($action !== 'delete') {
                foreach ($rows as $row) {
                    $users[] = self::toUser($this->byId($row->id));
                }
            }

            return ['affected' => count($rows), 'users' => $users];
        });
    }

    public function remove(string $id): void
    {
        if (! DB::table('clients')->where('id', $id)->delete()) {
            throw fail(404, 'NOT_FOUND');
        }
    }

    public static function uuid(): string
    {
        return (string) \Illuminate\Support\Str::uuid();
    }
}
