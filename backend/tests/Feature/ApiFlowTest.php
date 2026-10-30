<?php

namespace Tests\Feature;

use App\Services\Notifier;
use App\Services\Outbox;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class ApiFlowTest extends TestCase
{
    use DatabaseMigrations;

    private const PASSWORD = 'correct horse battery staple';
    private string $device;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        config(['dwira.admin.email' => 'Owner@Example.com', 'dwira.admin.password_hash' => password_hash(self::PASSWORD, PASSWORD_BCRYPT, ['cost' => 4])]);
        $this->device = bin2hex(random_bytes(32));
        // Delivery happens after the response; keep jobs in the outbox so the tests can inspect them.
        $this->app->instance(Outbox::class, new class($this->app->make(Notifier::class)) extends Outbox {
            public function afterResponse(string $jobId): void
            {
            }

            public function afterResponseIfDue(): void
            {
            }
        });
        Cache::put('dwira:background', 1, 600);
    }

    /** Cache-Control directives, order-insensitive (Symfony sorts them). */
    private function directives(?string $header): array
    {
        $parts = array_map('trim', explode(',', (string) $header));
        sort($parts);

        return $parts;
    }

    private function adminToken(): string
    {
        $r = $this->postJson('/api/admin/login', ['email' => 'owner@example.com', 'password' => self::PASSWORD], ['X-Dwira-Native' => '1']);
        $r->assertOk();

        return $r->json('token');
    }

    private function admin(string $token): array
    {
        return ['Authorization' => "Bearer $token"];
    }

    /** @return array{0:array,1:array} headers + user */
    private function client(string $name = 'Amine Test', string $phone = '+212 600 111 222'): array
    {
        $r = $this->postJson('/api/user/login', ['name' => $name, 'phone' => $phone], ['X-Dwira-Native' => '1', 'X-Demand-Token' => $this->device]);
        $r->assertOk();

        return [['X-User-Token' => $r->json('token'), 'X-Demand-Token' => $this->device], $r->json('user')];
    }

    public function test_content_is_cached_with_etag_and_hides_provider_keys(): void
    {
        $r = $this->getJson('/api/content');
        $r->assertOk();
        $this->assertSame($this->directives('public, max-age=0, s-maxage=30, stale-while-revalidate=300'), $this->directives($r->headers->get('Cache-Control')));
        $etag = $r->headers->get('ETag');
        $this->assertNotEmpty($etag);
        $this->assertNotEmpty($r->json('collections.models'));
        foreach ($r->json('collections.models') as $m) {
            $this->assertSame('', $m['apiKey']);
        }
        $this->assertArrayHasKey('docs', $r->json());
        // Revalidation: unchanged catalogue -> 304 without a body.
        $this->get('/api/content', ['If-None-Match' => $etag])->assertStatus(304);
        // One query to validate the cached snapshot (sync version) - no content tables are read again.
        DB::flushQueryLog();
        DB::enableQueryLog();
        $this->getJson('/api/content')->assertOk();
        $tables = collect(DB::getQueryLog())->pluck('query')->filter(fn ($q) => str_contains($q, 'content_items'))->count();
        $this->assertSame(0, $tables, 'cached snapshot must not re-read content_items');
        // An admin-panel request is never cached.
        $admin = $this->getJson('/api/content?a=1')->assertOk();
        $this->assertSame($this->directives('private, no-store'), $this->directives($admin->headers->get('Cache-Control')));
        $this->assertNull($admin->headers->get('ETag'));
    }

    public function test_admin_has_no_default_account_and_session_cookie_matches_node(): void
    {
        $this->postJson('/api/admin/login', ['email' => 'admin', 'password' => 'admin'])->assertStatus(401)->assertExactJson(['error' => 'Invalid credentials']);
        $this->postJson('/api/admin/login', ['email' => 'owner@example.com', 'password' => 'wrong'])->assertStatus(401);
        $r = $this->postJson('/api/admin/login', ['email' => ' OWNER@example.com ', 'password' => self::PASSWORD]);
        $r->assertOk()->assertExactJson(['ok' => true, 'user' => ['id' => 'usr_admin', 'name' => 'Admin']]);
        $cookie = $r->headers->get('Set-Cookie');
        $this->assertMatchesRegularExpression('#^dwira_admin=[a-f0-9]{64};#', $cookie);
        foreach (['max-age=604800', 'path=/api', 'secure', 'httponly', 'samesite=strict'] as $attribute) {
            $this->assertStringContainsString($attribute, strtolower($cookie));
        }
        $token = substr($cookie, 12, 64);
        // The cookie alone (as a browser sends it) authenticates.
        $this->getJson('/api/admin/session', ['Cookie' => "dwira_admin=$token"])->assertOk()->assertJsonPath('ok', true);
        $this->getJson('/api/admin/session')->assertStatus(401)->assertExactJson(['error' => 'Admin login required']);
        $out = $this->postJson('/api/admin/logout', [], ['Cookie' => "dwira_admin=$token"]);
        $out->assertOk()->assertExactJson(['ok' => true]);
        $this->assertStringContainsString('Max-Age=0', $out->headers->get('Set-Cookie'));
        $this->getJson('/api/admin/session', ['Cookie' => "dwira_admin=$token"])->assertStatus(401);
        // Only the SHA-256 of the token is stored.
        $this->assertSame(0, DB::table('admin_sessions')->where('token_hash', $token)->count());
    }

    public function test_json_body_rules(): void
    {
        $this->post('/api/user/login', ['name' => 'x'])->assertStatus(415)->assertExactJson(['error' => 'JSON required']);
        $this->call('POST', '/api/user/login', [], [], [], ['CONTENT_TYPE' => 'application/json'], '{bad')->assertStatus(400)->assertExactJson(['error' => 'Invalid JSON']);
        $this->postJson('/api/user/login', ['name' => 'A', 'phone' => '1'])->assertStatus(400)->assertExactJson(['error' => 'INVALID_PROFILE']);
    }

    public function test_sync_is_cheap_for_anonymous_and_complete_for_admin(): void
    {
        DB::flushQueryLog();
        DB::enableQueryLog();
        $r = $this->getJson('/api/sync');
        $r->assertOk()->assertExactJson(['content' => 0, 'campaigns' => null, 'requests' => null, 'clients' => null, 'chats' => null, 'admin' => null, 'client' => null, 'guest' => null, 'user' => null, 'isAdmin' => false]);
        $this->assertCount(1, DB::getQueryLog(), 'an anonymous poll is ONE query');
        $token = $this->adminToken();
        $a = $this->getJson('/api/sync', $this->admin($token))->assertOk();
        $this->assertTrue($a->json('isAdmin'));
        $this->assertSame(0, $a->json('requests'));
        [$h, $user] = $this->client();
        $c = $this->getJson('/api/sync', $h)->assertOk();
        $this->assertSame(['id' => $user['id'], 'blocked' => false], $c->json('user'));
        $this->assertNotNull($c->json('client'));
        $g = $this->getJson('/api/sync', ['X-Demand-Token' => bin2hex(random_bytes(32))])->assertOk();
        $this->assertSame(0, $g->json('guest'));
    }

    public function test_client_login_claim_request_and_delivery_flow(): void
    {
        [$h, $user] = $this->client();
        $this->assertSame(1, $user['credits']);
        $this->assertSame('+212600111222', $user['whatsapp']);
        $this->getJson('/api/user/session', $h)->assertOk()->assertJsonPath('user.id', $user['id']);
        // a new lead is queued for the admins
        $this->assertSame(1, DB::table('outbox')->where('kind', 'lead')->count());

        $png = 'data:image/png;base64,'.base64_encode($this->png());
        $body = ['id' => 'req_00000001', 'photoUri' => $png, 'draft' => ['toolId' => 'staging', 'styleId' => 'modern', 'junk' => 'dropped']];
        $r = $this->postJson('/api/requests', $body, $h)->assertStatus(201);
        $this->assertSame('pending', $r->json('status'));
        $this->assertSame($user['id'], $r->json('userId'));
        $this->assertMatchesRegularExpression('#^/api/media/[a-f0-9]{32}\.[a-z0-9]+$#', $r->json('photoUri'));
        $this->assertArrayNotHasKey('clientHash', $r->json());
        $this->assertArrayNotHasKey('junk', $r->json('draft'));
        $id = $r->json('id');
        // idempotent replay returns the same request, no duplicate, one outbox job
        $again = $this->postJson('/api/requests', $body, $h)->assertStatus(201);
        $this->assertSame($id, $again->json('id'));
        $this->assertSame(1, DB::table('requests')->count());
        $this->assertSame(1, DB::table('outbox')->where('kind', 'request')->count());
        // claim charged the free design once
        $this->assertSame(0, $this->getJson('/api/user/session', $h)->json('user.credits'));

        $this->postJson('/api/requests', ['id' => 'x', 'photoUri' => $png, 'draft' => ['toolId' => 't']], $h)->assertStatus(400);
        $this->postJson('/api/requests', $body, ['X-User-Token' => $h['X-User-Token']])->assertStatus(400)->assertExactJson(['error' => 'Client token required']);
        $this->postJson('/api/requests', $body)->assertStatus(400);
        $this->getJson('/api/user/requests', $h)->assertOk()->assertJsonCount(1);

        // someone else gets 404, not 403
        [$other] = (function () {
            $this->device = bin2hex(random_bytes(32));

            return $this->client('Other Person', '+212 611 000 000');
        })();
        $this->getJson("/api/requests/$id", $other)->assertStatus(404)->assertExactJson(['error' => 'Not found']);
        $this->getJson('/api/requests')->assertStatus(401);

        $token = $this->adminToken();
        $this->getJson('/api/requests', $this->admin($token))->assertOk()->assertJsonCount(1);
        $this->patchJson("/api/requests/$id", ['status' => 'bogus'], $this->admin($token))->assertStatus(400)->assertExactJson(['error' => 'Invalid status']);
        // the client may not set the status
        $this->patchJson("/api/requests/$id", ['status' => 'delivered'], $h)->assertOk()->assertJsonPath('status', 'pending');

        // history entry for the claimed id, then the admin delivers -> history gets the result + owner is notified
        $this->postJson('/api/user/history', ['claimId' => 'req_00000001', 'draft' => ['toolId' => 'staging'], 'before' => '/api/media/'.str_repeat('a', 32).'.webp', 'status' => 'pending'], $h)->assertOk()->assertJsonPath('id', 'req_00000001');
        $this->postJson('/api/user/history', ['claimId' => 'req_99999999', 'draft' => ['toolId' => 'x'], 'before' => 'b', 'status' => 'pending'], $h)->assertStatus(403)->assertExactJson(['error' => 'CLAIM_REQUIRED']);
        $this->patchJson("/api/requests/$id", ['historyId' => 'req_00000001'], $h)->assertOk();
        $done = $this->patchJson("/api/requests/$id", ['status' => 'delivered', 'finalResult' => $png], $this->admin($token))->assertOk();
        $this->assertSame('delivered', $done->json('status'));
        $this->assertSame(1, DB::table('outbox')->where('kind', 'ready')->count());
        $hist = $this->getJson('/api/user/history/req_00000001', $h)->assertOk();
        $this->assertSame('done', $hist->json('status'));
        $this->assertSame($done->json('finalResult'), $hist->json('after'));

        $this->deleteJson("/api/requests/$id", [], $h)->assertStatus(401);
        $this->deleteJson("/api/requests/$id", [], $this->admin($token))->assertOk()->assertExactJson(['ok' => true]);
        $this->assertSame(0, DB::table('requests')->count());
    }

    public function test_conversations_guest_adoption_and_admin_reply(): void
    {
        $guest = ['X-Demand-Token' => $this->device];
        $c = $this->postJson('/api/guest/conversations', ['title' => 'Hello', 'messages' => [['id' => 'm1', 'role' => 'user', 'text' => 'hi', 'createdAt' => 1], ['id' => 'm2', 'role' => 'admin', 'text' => 'forged', 'createdAt' => 2]]], $guest)->assertOk();
        $this->assertCount(1, $c->json('messages'), 'a visitor cannot forge admin messages');
        $this->assertSame('guest', $c->json('userId'));
        $cid = $c->json('id');
        $this->assertSame(1, DB::table('outbox')->where('kind', 'chat')->count());
        $this->getJson("/api/guest/conversations/$cid", $guest)->assertOk();
        $this->getJson('/api/guest/conversations/nope', $guest)->assertStatus(404);
        $this->getJson('/api/guest/conversations')->assertStatus(400)->assertExactJson(['error' => 'Client token required']);

        $token = $this->adminToken();
        $list = $this->getJson('/api/admin/conversations', $this->admin($token))->assertOk();
        $this->assertTrue($list->json('0.guest'));
        $this->postJson("/api/admin/conversations/$cid", ['text' => '   '], $this->admin($token))->assertStatus(400)->assertExactJson(['error' => 'INVALID_MESSAGE']);
        $reply = $this->postJson("/api/admin/conversations/$cid", ['text' => ' Bonjour '], $this->admin($token))->assertOk();
        $this->assertSame('Bonjour', $reply->json('messages.1.text'));
        // a visitor reply is picked up by the sync loop only
        $this->assertSame(0, DB::table('outbox')->where('kind', 'reply')->count());
        $this->assertSame(2, $this->getJson('/api/sync', $guest)->json('guest'));

        // sign in: the device's chats become the client's
        [$h, $user] = $this->client();
        $this->getJson('/api/guest/conversations', $h)->assertStatus(409)->assertExactJson(['error' => 'ALREADY_SIGNED_IN']);
        $mine = $this->getJson('/api/user/conversations', $h)->assertOk();
        $this->assertCount(1, $mine->json());
        $this->assertSame($user['id'], $mine->json('0.userId'));
        $this->postJson("/api/admin/conversations/$cid", ['text' => 'again'], $this->admin($token))->assertOk();
        $this->assertSame(1, DB::table('outbox')->where('kind', 'reply')->count());
        // the client's PATCH cannot erase the admin's messages
        $upd = $this->patchJson("/api/user/conversations/$cid", ['title' => 'T', 'messages' => [['id' => 'm1', 'role' => 'user', 'text' => 'hi', 'createdAt' => 1]]], $h)->assertOk();
        $this->assertSame(['user', 'admin', 'admin'], array_column($upd->json('messages'), 'role'));
        $this->deleteJson("/api/user/conversations/$cid", [], $h)->assertOk();
    }

    public function test_admin_clients_credits_bulk_and_content_editing(): void
    {
        [, $user] = $this->client();
        $a = $this->admin($this->adminToken());
        $this->getJson('/api/admin/clients')->assertStatus(401);
        $this->assertCount(1, $this->getJson('/api/admin/clients', $a)->assertOk()->json());
        $this->patchJson("/api/admin/clients/{$user['id']}", ['credits' => 5], $a)->assertOk()->assertJsonPath('credits', 5);
        $this->patchJson("/api/admin/clients/{$user['id']}", ['credits' => -1], $a)->assertStatus(400)->assertExactJson(['error' => 'INVALID_CREDITS']);
        $this->patchJson("/api/admin/clients/{$user['id']}", ['blocked' => 'yes'], $a)->assertStatus(400);
        $this->postJson('/api/admin/clients/bulk', ['ids' => [$user['id']], 'action' => 'credits', 'mode' => 'add', 'amount' => 2], $a)->assertOk()->assertJsonPath('users.0.credits', 7);
        $this->patchJson("/api/admin/clients/{$user['id']}", ['blocked' => true], $a)->assertOk()->assertJsonPath('blocked', true);
        $this->postJson('/api/user/login', ['name' => 'Amine Test', 'phone' => '+212600111222'])->assertStatus(403)->assertExactJson(['error' => 'ACCOUNT_BLOCKED']);
        $this->postJson('/api/admin/clients/bulk', ['ids' => [], 'action' => 'block'], $a)->assertStatus(400)->assertExactJson(['error' => 'INVALID_IDS']);
        $this->postJson('/api/admin/clients/bulk', ['ids' => [$user['id']], 'action' => 'delete'], $a)->assertOk()->assertJsonPath('affected', 1);
        $this->deleteJson("/api/admin/clients/{$user['id']}", [], $a)->assertStatus(404);

        // content editing bumps the version, so the cached snapshot is replaced and the ETag changes
        $before = $this->getJson('/api/content');
        $first = $before->json('collections.styles.0');
        $this->assertNotNull($first);
        $put = $this->putJson('/api/admin/content/styles/'.$first['id'], array_merge($first, ['name' => 'Renamed']), $a)->assertOk();
        $this->assertSame('Renamed', $put->json('name'));
        $after = $this->getJson('/api/content');
        $this->assertNotSame($before->headers->get('ETag'), $after->headers->get('ETag'));
        $this->assertSame('Renamed', collect($after->json('collections.styles'))->firstWhere('id', $first['id'])['name']);
        $this->putJson('/api/admin/content/styles', [], $a)->assertStatus(405);
        $this->patchJson('/api/admin/doc/settings', ['defaultFreeCredits' => 3], $a)->assertOk();
        $this->assertSame(3, $this->getJson('/api/content')->json('docs.settings.defaultFreeCredits'));
    }

    public function test_media_upload_serving_thumbnails_and_caching(): void
    {
        $a = $this->admin($this->adminToken());
        $png = 'data:image/png;base64,'.base64_encode($this->png(900, 600));
        $this->postJson('/api/admin/media', ['data' => $png])->assertStatus(401);
        $this->postJson('/api/admin/media', ['data' => 'nope'], $a)->assertStatus(400)->assertExactJson(['error' => 'INVALID_MEDIA']);
        $url = $this->postJson('/api/admin/media', ['data' => $png], $a)->assertOk()->json('url');
        $this->assertMatchesRegularExpression('#^/api/media/[a-f0-9]{32}\.[a-z0-9]+$#', $url);
        // idempotent: same bytes -> same URL, one row
        $this->assertSame($url, $this->postJson('/api/admin/media', ['data' => $png], $a)->json('url'));
        $this->assertSame(1, DB::table('media')->count());

        $r = $this->get($url);
        $r->assertOk();
        $this->assertSame($this->directives('public, max-age=31536000, s-maxage=31536000, immutable'), $this->directives($r->headers->get('Cache-Control')));
        $etag = $r->headers->get('ETag');
        $this->get($url, ['If-None-Match' => $etag])->assertStatus(304);
        $this->assertSame('image/webp', $this->get("$url?w=320")->headers->get('Content-Type'));
        $this->get('/api/media/'.str_repeat('0', 32).'.webp')->assertStatus(404)->assertExactJson(['error' => 'NOT_FOUND']);
        $this->get('/api/media/..%2f..%2f.env')->assertStatus(404);
        $this->call('HEAD', $url)->assertOk();

        // raw upload (what src/lib/media.ts sends) and the R2 fallback signal
        $raw = $this->call('POST', '/api/admin/media/raw', [], [], [], ['CONTENT_TYPE' => 'image/png', 'HTTP_AUTHORIZATION' => 'Bearer '.substr($a['Authorization'], 7)], $this->png(50, 50));
        $raw->assertOk();
        $this->postJson('/api/admin/media/presign', ['contentType' => 'video/mp4', 'size' => 5], $a)->assertStatus(503)->assertExactJson(['error' => 'R2_NOT_CONFIGURED']);
        $this->postJson('/api/admin/media/import', ['url' => 'http://example.com/a.png'], $a)->assertStatus(400);
        $this->call('POST', '/api/admin/media/raw', [], [], [], ['CONTENT_TYPE' => 'text/html', 'HTTP_AUTHORIZATION' => $a['Authorization']], '<html>')->assertStatus(400);
    }

    public function test_push_config_subscriptions_and_pump_auth(): void
    {
        $cfg = $this->getJson('/api/push/config')->assertOk()->json();
        $this->assertTrue($cfg['web']);
        $this->assertFalse($cfg['android']);
        $this->assertNotEmpty($cfg['publicKey']);
        $sub = ['subscription' => ['endpoint' => 'https://fcm.googleapis.com/fcm/send/abc', 'keys' => ['p256dh' => rtrim(strtr(base64_encode(str_repeat('p', 65)), '+/', '-_'), '='), 'auth' => rtrim(strtr(base64_encode(str_repeat('a', 16)), '+/', '-_'), '=')]]];
        $this->postJson('/api/push/subscriptions', $sub)->assertStatus(401)->assertExactJson(['error' => 'Admin login required']);
        $this->postJson('/api/push/subscriptions', ['owner' => 'client'] + $sub)->assertStatus(401)->assertExactJson(['error' => 'USER_LOGIN_REQUIRED']);
        $a = $this->admin($this->adminToken());
        $this->postJson('/api/push/subscriptions', ['junk' => 1], $a)->assertStatus(400)->assertExactJson(['error' => 'Invalid subscription']);
        $this->postJson('/api/push/subscriptions', $sub, $a)->assertOk()->assertExactJson(['ok' => true]);
        $this->assertSame(1, app(Notifier::class)->count());
        $this->deleteJson('/api/push/subscriptions', $sub, $a)->assertOk();
        $this->assertSame(0, app(Notifier::class)->count());
        $this->postJson('/api/push/test', [], $a)->assertStatus(409)->assertExactJson(['error' => 'NO_SUBSCRIPTION']);

        $this->getJson('/api/push/pump')->assertStatus(401);
        $this->getJson('/api/push/pump', ['Authorization' => 'Bearer guess'])->assertStatus(401);
        config(['dwira.cron_secret' => 'cron-secret-value']);
        $this->getJson('/api/push/pump', ['Authorization' => 'Bearer cron-secret-value'])->assertOk()->assertJsonPath('ok', true);
        $this->getJson('/api/push/pump', ['Authorization' => 'Bearer '])->assertStatus(401);
    }

    public function test_campaign_crud(): void
    {
        $a = $this->admin($this->adminToken());
        $this->getJson('/api/admin/campaigns')->assertStatus(401);
        $this->getJson('/api/admin/campaigns', $a)->assertOk()->assertExactJson([]);
        $this->getJson('/api/admin/campaigns/segments', $a)->assertOk();
        $this->getJson('/api/admin/campaigns/people', $a)->assertOk();
        $this->getJson('/api/admin/campaigns/zzz', $a)->assertStatus(404)->assertExactJson(['error' => 'NOT_FOUND']);
        $this->postJson('/api/admin/campaigns', ['name' => ''], $a)->assertStatus(400);
        $created = $this->postJson('/api/admin/campaigns', ['kind' => 'once', 'name' => 'Spring', 'title' => ['fr' => 'Bonjour {name}', 'ar' => 'مرحبا'], 'body' => ['fr' => 'Nouveaux designs'], 'url' => '/', 'audience' => ['segments' => ['all']]], $a)->assertStatus(201);
        $id = $created->json('id');
        $this->assertSame('draft', $created->json('status'));
        $this->getJson("/api/admin/campaigns/$id", $a)->assertOk();
        $this->postJson('/api/admin/campaigns/preview', ['segments' => ['all']], $a)->assertOk()->assertJsonStructure(['matched', 'reachable', 'total', 'reachableTotal']);
        $this->postJson("/api/admin/campaigns/$id/duplicate", [], $a)->assertStatus(201);
        $this->getJson("/api/admin/campaigns/$id/duplicate", $a)->assertStatus(405);
        $this->deleteJson("/api/admin/campaigns/$id", [], $a)->assertOk()->assertExactJson(['ok' => true]);
    }

    public function test_prefs_and_chat_guards(): void
    {
        $this->getJson('/api/prefs')->assertStatus(401)->assertExactJson(['error' => 'USER_LOGIN_REQUIRED']);
        $this->getJson('/api/prefs?as=admin')->assertStatus(401)->assertExactJson(['error' => 'Admin login required']);
        [$h] = $this->client();
        $this->patchJson('/api/prefs', ['language' => 'fr'], $h)->assertOk();
        $this->getJson('/api/prefs', $h)->assertOk();
        $this->putJson('/api/prefs', [], $h)->assertStatus(405);
        $this->postJson('/api/chat/reply', ['messages' => []])->assertStatus(400)->assertExactJson(['error' => 'Client token required']);
        $this->getJson('/api/admin/chat/status')->assertStatus(401);
        $a = $this->admin($this->adminToken());
        $this->getJson('/api/admin/chat/status', $a)->assertOk();
    }

    private function png(int $w = 40, int $h = 30): string
    {
        $im = imagecreatetruecolor($w, $h);
        imagefill($im, 0, 0, imagecolorallocate($im, 200, 100, 50));
        ob_start();
        imagepng($im);

        return (string) ob_get_clean();
    }
}
