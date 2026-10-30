<?php

namespace Tests\Feature;

use App\Services\Content;
use App\Services\Notifier;
use App\Services\PushFailure;
use App\Services\Settings;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

class NotifierTest extends TestCase
{
    use DatabaseMigrations;

    private array $webCalls = [];

    private array $fcmCalls = [];

    private static function b64(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    private function webSub(string $path = '/abc', string $host = 'fcm.googleapis.com', string $lang = 'fr'): array
    {
        return ['subscription' => ['endpoint' => "https://$host/fcm/send$path", 'keys' => ['p256dh' => self::b64(str_repeat('p', 65)), 'auth' => self::b64(str_repeat('a', 16))]], 'language' => $lang];
    }

    private function notifier(?\Closure $web = null, ?\Closure $fcm = null): Notifier
    {
        return new Notifier(app(Settings::class), app(Content::class),
            $web ?? function (array $s, string $payload, array $o) {
                $this->webCalls[] = [$s, json_decode($payload, true), $o];
            },
            $fcm ?? function (string $t, array $p) {
                $this->fcmCalls[] = [$t, $p];
            });
    }

    private function client(string $id = 'c1', string $prefs = '{}'): void
    {
        DB::table('clients')->insert(['id' => $id, 'phone' => '+2126'.random_int(10000000, 99999999), 'name' => 'Amina Test', 'created_at' => 1, 'prefs' => $prefs]);
    }

    private function setSettings(array $doc): void
    {
        DB::table('content_docs')->updateOrInsert(['name' => 'settings'], ['data' => json_encode($doc), 'updated_at' => 1]);
    }

    public function test_payload_texts_per_event_and_language(): void
    {
        $req = (object) ['id' => 'r 1/é', 'name' => 'Sara', 'whatsapp' => '+212 6-12 34'];
        $p = Notifier::payloadFor($req, 'fr', 'request');
        $this->assertSame('Nouvelle demande', $p['title']);
        $this->assertSame('Sara - +212612'.'34', $p['body']);
        $this->assertSame('/admin/requests?target=r%201%2F%C3%A9&open=r%201%2F%C3%A9', $p['url']);
        $this->assertSame(['Ouvrir', 'Appeler'], array_column($p['actions'], 'title'));
        $this->assertSame('ltr', $p['dir']);

        $this->assertSame('rtl', Notifier::payloadFor($req, 'ar')['dir']);
        $this->assertSame('rtl', Notifier::payloadFor($req, 'dar')['dir']);
        $this->assertSame('New demand', Notifier::payloadFor($req, 'xx')['title'], 'unknown language falls back to en');
        $this->assertSame('New demand', Notifier::payloadFor($req, null)['title']);

        $this->assertSame('New lead', Notifier::payloadFor($req, 'en', 'lead')['title']);
        $this->assertStringStartsWith('/admin/users?target=', Notifier::payloadFor($req, 'en', 'lead')['url']);

        $chat = Notifier::payloadFor((object) ['id' => 'g1', 'text' => str_repeat('x', 300), 'name' => ''], 'en', 'chat');
        $this->assertSame('Visitor: '.str_repeat('x', 100), $chat['body']);
        $this->assertSame('Visitor: 📷', Notifier::payloadFor((object) ['id' => 'g1'], 'en', 'chat')['body']);

        $ready = Notifier::payloadFor((object) ['id' => 'r1'], 'en', 'ready');
        $this->assertSame(['Your design is ready', 'Open the app to see it.', '/history'], [$ready['title'], $ready['body'], $ready['url']]);
        $this->assertCount(1, $ready['actions']);

        $reply = Notifier::payloadFor((object) ['id' => 'g1', 'text' => ''], 'fr', 'reply');
        $this->assertSame('Ouvrez la conversation pour la lire.', $reply['body']);
        $this->assertSame('/chat/g1', $reply['url']);
    }

    public function test_campaign_payload_personalises_picks_language_and_whitelists_url(): void
    {
        $c = (object) ['id' => 'cmp1', 'name' => 'Amina Test', 'url' => '/tool/abc_1',
            'title' => (object) ['fr' => 'Salut {name} !', 'ar' => ''], 'body' => (object) ['fr' => '', 'dar' => 'مرحبا {name} ,x', 'ar' => 'x']];
        $p = Notifier::payloadFor($c, 'ar', 'campaign');
        $this->assertSame('Salut Amina!', $p['title'], 'falls back ar -> dar -> fr, first name only, space before ! removed');
        $this->assertSame('x', $p['body']);
        $this->assertSame('campaign-cmp1', $p['requestId']);
        $this->assertSame('/tool/abc_1', $p['url']);

        foreach (['https://evil.example/', '//evil.example', '/admin', '/tool/', '/explore?x=1', 42] as $bad) {
            $c->url = $bad;
            $this->assertSame('/', Notifier::payloadFor($c, 'fr', 'campaign')['url'], 'url '.json_encode($bad));
        }
        $c->url = '/explore';
        $this->assertSame('/explore', Notifier::payloadFor($c, 'fr', 'campaign')['url']);
    }

    public function test_validate_subscription_accepts_known_providers(): void
    {
        foreach (['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com', 'x.push.services.mozilla.com', 'a.push.apple.com', 'db5.notify.windows.com'] as $h) {
            $v = Notifier::validateSubscription($this->webSub('/z', $h));
            $this->assertSame('web', $v['kind'], $h);
            $this->assertSame(hash('sha256', "https://$h/fcm/send/z"), $v['id']);
        }
        $v = Notifier::validateSubscription(['subscription' => $this->webSub('', 'FCM.GOOGLEAPIS.COM')['subscription'], 'language' => 'zz']);
        $this->assertStringStartsWith('https://fcm.googleapis.com/', $v['subscription']['endpoint'], 'host lower-cased');
        $this->assertSame('en', $v['language']);

        $f = Notifier::validateSubscription(['kind' => 'fcm', 'token' => str_repeat('a1:_-', 8), 'language' => 'ar']);
        $this->assertSame(['fcm', 'ar', hash('sha256', str_repeat('a1:_-', 8))], [$f['kind'], $f['language'], $f['id']]);
    }

    public function test_validate_subscription_rejects_bad_input(): void
    {
        $good = $this->webSub();
        $cases = [
            'null' => null,
            'string' => 'x',
            'no endpoint' => ['subscription' => ['keys' => $good['subscription']['keys']]],
            'http' => ['subscription' => ['endpoint' => 'http://fcm.googleapis.com/x'] + $good['subscription']],
            'foreign host' => $this->webSub('/x', 'evil.example'),
            'suffix trick' => $this->webSub('/x', 'evilpush.apple.com.evil.example'),
            'metadata ip' => ['subscription' => ['endpoint' => 'https://169.254.169.254/'] + $good['subscription']],
            'userinfo' => ['subscription' => ['endpoint' => 'https://u:p@fcm.googleapis.com/x'] + $good['subscription']],
            'port' => ['subscription' => ['endpoint' => 'https://fcm.googleapis.com:8443/x'] + $good['subscription']],
            'too long' => ['subscription' => ['endpoint' => 'https://fcm.googleapis.com/'.str_repeat('a', 2100)] + $good['subscription']],
            'no keys' => ['subscription' => ['endpoint' => $good['subscription']['endpoint']]],
            'bad key chars' => ['subscription' => ['endpoint' => $good['subscription']['endpoint'], 'keys' => ['p256dh' => '!!', 'auth' => 'x']]],
            'short p256dh' => ['subscription' => ['endpoint' => $good['subscription']['endpoint'], 'keys' => ['p256dh' => self::b64('short'), 'auth' => self::b64(str_repeat('a', 16))]]],
            'short auth' => ['subscription' => ['endpoint' => $good['subscription']['endpoint'], 'keys' => ['p256dh' => self::b64(str_repeat('p', 65)), 'auth' => self::b64('a')]]],
            'fcm short token' => ['kind' => 'fcm', 'token' => 'abc'],
            'fcm bad chars' => ['kind' => 'fcm', 'token' => str_repeat('a', 30).' x'],
            'fcm huge' => ['kind' => 'fcm', 'token' => str_repeat('a', 5000)],
            'fcm non string' => ['kind' => 'fcm', 'token' => 12345678901234567890123],
        ];
        foreach ($cases as $name => $input) {
            try {
                Notifier::validateSubscription($input);
                $this->fail("accepted: $name");
            } catch (\InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function test_deliver_sends_to_every_admin_device_with_its_own_language(): void
    {
        $n = $this->notifier();
        $n->save(Notifier::validateSubscription($this->webSub('/1', 'fcm.googleapis.com', 'fr')));
        $n->save(Notifier::validateSubscription(['kind' => 'fcm', 'token' => str_repeat('t', 30), 'language' => 'ar']));
        $this->assertSame(2, $n->count());

        $r = $n->deliver((object) ['id' => 'r1', 'name' => 'Sara', 'whatsapp' => '0612']);
        $this->assertSame(['retry' => false, 'sent' => 2, 'devices' => 2], ['retry' => $r['retry'], 'sent' => $r['sent'], 'devices' => $r['devices']]);
        $this->assertCount(2, $r['completed']);
        $this->assertSame('Nouvelle demande', $this->webCalls[0][1]['title']);
        $this->assertSame(['TTL' => 86400, 'urgency' => 'high', 'timeout' => 8], $this->webCalls[0][2]);
        $this->assertSame('طلب جديد', $this->fcmCalls[0][1]['title']);

        // Retry with the completed list: nothing is sent twice.
        $again = $n->deliver((object) ['id' => 'r1', 'name' => 'Sara'], $r['completed']);
        $this->assertSame([0, 0, false], [$again['sent'], $again['devices'], $again['retry']]);
        $this->assertCount(1, $this->webCalls);
        $this->assertCount(1, $this->fcmCalls);

        // Saving the same device again updates, never duplicates.
        $n->save(Notifier::validateSubscription($this->webSub('/1', 'fcm.googleapis.com', 'en')));
        $this->assertSame(2, $n->count());
    }

    public function test_expired_devices_are_removed_and_transient_errors_retry(): void
    {
        $codes = ['/gone' => 410, '/missing' => 404, '/boom' => 500, '/ok' => 201];
        $web = function (array $s, string $payload, array $o) use (&$codes) {
            $status = $codes[substr($s['endpoint'], strlen('https://fcm.googleapis.com/fcm/send'))];
            if ($status >= 400) {
                throw new PushFailure($status);
            }
        };
        $n = $this->notifier($web);
        foreach (array_keys($codes) as $p) {
            $n->save(Notifier::validateSubscription($this->webSub($p)));
        }
        $n->save(Notifier::validateSubscription(['kind' => 'fcm', 'token' => str_repeat('k', 30)]));
        $n->fcm = fn () => throw new PushFailure(0, 'messaging/registration-token-not-registered');

        $r = $n->deliver((object) ['id' => 'r1', 'name' => 'x']);
        $this->assertTrue($r['retry'], 'a 500 must be retried');
        $this->assertSame(1, $r['sent']);
        $this->assertSame(5, $r['devices']);
        $this->assertSame(2, $n->count(), 'only 410, 404 and the unregistered FCM token are dropped');
        $this->assertCount(4, $r['completed'], 'the 500 device is not marked completed');

        // The retry only contacts the failing device.
        $codes['/boom'] = 201;
        $r2 = $n->deliver((object) ['id' => 'r1', 'name' => 'x'], $r['completed']);
        $this->assertSame([1, 1, false], [$r2['sent'], $r2['devices'], $r2['retry']]);
    }

    public function test_preferences_and_settings_switch_notifications_off(): void
    {
        $n = $this->notifier();
        $n->save(Notifier::validateSubscription($this->webSub('/a')), ['type' => 'admin', 'id' => 'a1']);
        $n->save(Notifier::validateSubscription($this->webSub('/b')), ['type' => 'admin', 'id' => 'a2']);
        $req = (object) ['id' => 'r1', 'name' => 'x'];

        DB::table('admin_prefs')->insert(['admin_id' => 'a2', 'data' => '{"notifications":false}']);
        $this->assertSame(1, $n->deliver($req)['devices'], 'admin with notifications=false is skipped');

        $this->setSettings(['notifyAdmins' => false]);
        $this->assertFalse($n->enabled('admin'));
        $this->assertSame(0, $n->deliver($req)['devices']);
        $this->setSettings([]);
        $this->assertTrue($n->enabled('admin'));

        // Client audience
        $this->client('c1');
        $this->client('c2', '{"notifications":false}');
        foreach (['c1', 'c2'] as $i => $id) {
            $n->save(Notifier::validateSubscription($this->webSub('/c'.$i)), ['type' => 'client', 'id' => $id]);
        }
        $opt = fn ($id) => ['event' => 'ready', 'audience' => ['type' => 'client', 'id' => $id]];
        $this->assertSame(1, $n->deliver($req, [], $opt('c1'))['sent']);
        $this->assertSame(0, $n->deliver($req, [], $opt('c2'))['devices'], 'client prefs notifications=false');
        $this->assertSame(0, $n->deliver($req, [], $opt('nobody'))['devices']);
        $this->setSettings(['notifyUsers' => false]);
        $this->assertSame(0, $n->deliver($req, [], $opt('c1'))['devices'], 'notifyUsers=false');
        $this->assertSame(1, $n->deliver($req)['devices'], 'admin audience unaffected by notifyUsers (a2 is still opted out)');

        $subs = $n->clientSubscribers();
        $this->assertCount(2, $subs);
        $this->assertSame(['c1' => 'paused', 'c2' => 'paused'], array_column($subs, 'status', 'id'), 'notifyUsers=false pauses everyone');
        $this->setSettings([]);
        $subs = $n->clientSubscribers();
        $this->assertSame(['c1' => 'on', 'c2' => 'off'], array_column($subs, 'status', 'id'));
        $this->assertSame([1, 0, 1], [$subs[0]['devices'], $subs[0]['apps'], $subs[0]['browsers']]);

        $n->removeOwner('client', 'c1');
        $this->assertCount(1, $n->clientSubscribers());
    }

    public function test_remove_by_device_respects_owner(): void
    {
        $n = $this->notifier();
        $sub = Notifier::validateSubscription($this->webSub('/shared'));
        $n->save($sub, ['type' => 'admin', 'id' => 'a1']);
        $n->save($sub, ['type' => 'admin', 'id' => 'a2']);
        $this->assertSame(2, $n->count());
        $n->remove($sub['id'], ['type' => 'admin', 'id' => 'a1']);
        $this->assertSame(1, $n->count());
        $n->remove($sub['id']);
        $this->assertSame(0, $n->count());
    }

    public function test_failures_are_logged_without_secrets(): void
    {
        $logged = [];
        Log::shouldReceive('warning')->andReturnUsing(function ($msg, $ctx = []) use (&$logged) {
            $logged[] = json_encode([$msg, $ctx]);
        });
        $n = $this->notifier(fn () => throw new PushFailure(503));
        $token = str_repeat('s3cret', 6);
        $n->save(Notifier::validateSubscription($this->webSub('/leaky')));
        $n->fcm = fn () => throw new PushFailure(0, 'messaging/quota');
        $n->save(Notifier::validateSubscription(['kind' => 'fcm', 'token' => $token]));
        $n->deliver((object) ['id' => 'r1', 'name' => 'Sara Secret', 'whatsapp' => '+212611223344']);

        $this->assertCount(2, $logged);
        $all = implode('', $logged);
        foreach (['leaky', 'fcm.googleapis.com', $token, 'Sara', '+212611223344', 'p256dh'] as $secret) {
            $this->assertStringNotContainsString($secret, $all);
        }
    }

    public function test_vapid_keys_are_generated_once_and_stored_encrypted(): void
    {
        config(['dwira.vapid.public' => null, 'dwira.vapid.private' => null]);
        $a = $this->notifier()->vapid();
        $this->assertNotEmpty($a['publicKey']);
        $this->assertNotEmpty($a['privateKey']);

        $b = $this->notifier()->vapid();
        $this->assertSame($a['publicKey'], $b['publicKey'], 'second instance reuses the stored pair');
        $raw = DB::table('settings')->get()->map(fn ($r) => json_encode($r))->implode('');
        $this->assertStringNotContainsString($a['privateKey'], $raw, 'private key never stored in clear text');

        $this->assertSame(['publicKey' => $a['publicKey'], 'web' => true, 'android' => true], $this->notifier()->config(), 'fcm closure makes android available');
        $this->assertFalse((new Notifier(app(Settings::class), app(Content::class)))->fcmConfigured());
    }
}
