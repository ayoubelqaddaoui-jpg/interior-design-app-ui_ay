<?php

namespace App\Services;

use App\Support\Json;
use App\Support\Str;
use Closure;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\VAPID;
use Minishlink\WebPush\WebPush;

/** Port of server/notifications.js: payload texts, subscription validation, Web Push (VAPID) and FCM HTTP v1. */
class Notifier
{
    public const TEXT = [
        'en' => ['guest' => 'Visitor', 'title' => 'New demand', 'lead' => 'New lead', 'ready' => 'Your design is ready', 'readyBody' => 'Open the app to see it.', 'open' => 'Open', 'call' => 'Call', 'chat' => 'New message', 'reply' => 'New reply', 'replyBody' => 'Open the chat to read it.'],
        'fr' => ['guest' => 'Visiteur', 'title' => 'Nouvelle demande', 'lead' => 'Nouveau client', 'ready' => 'Votre design est prêt', 'readyBody' => 'Ouvrez l’app pour le voir.', 'open' => 'Ouvrir', 'call' => 'Appeler', 'chat' => 'Nouveau message', 'reply' => 'Nouvelle réponse', 'replyBody' => 'Ouvrez la conversation pour la lire.'],
        'ar' => ['guest' => 'زائر', 'title' => 'طلب جديد', 'lead' => 'عميل جديد', 'ready' => 'تصميمك جاهز', 'readyBody' => 'افتح التطبيق لمشاهدته.', 'open' => 'فتح', 'call' => 'اتصال', 'chat' => 'رسالة جديدة', 'reply' => 'رد جديد', 'replyBody' => 'افتح المحادثة لقراءته.'],
        'dar' => ['guest' => 'زائر', 'title' => 'طلب جديد', 'lead' => 'كليون جديد', 'ready' => 'التصميم ديالك واجد', 'readyBody' => 'حل التطبيق باش تشوفو.', 'open' => 'فتح', 'call' => 'اتصال', 'chat' => 'ميساج جديد', 'reply' => 'جواب جديد', 'replyBody' => 'حل المحادثة باش تقراه.'],
    ];

    public const CAMPAIGN_URL = '#^/(?:(?:explore|assistant|history|pro|settings|tool/[A-Za-z0-9_-]{1,100}))?$#D';

    private const PICK = ['dar' => ['dar', 'ar', 'fr'], 'ar' => ['ar', 'dar', 'fr'], 'fr' => ['fr', 'ar', 'dar'], 'en' => ['fr', 'ar', 'dar']];

    private ?array $vapid = null;

    /** @param Closure|null $web fn(array $subscription, string $payload, array $opts): void (throws with ->statusCode)  @param Closure|null $fcm fn(string $token, array $payload): void */
    public function __construct(private readonly Settings $settings, private readonly Content $content, public ?Closure $web = null, public ?Closure $fcm = null)
    {
    }

    // ---- text helpers (JS semantics) ----

    public static function trim(mixed $value, int $max): string
    {
        $s = is_string($value) ? $value : ($value === null ? '' : (is_scalar($value) ? (is_bool($value) ? ($value ? 'true' : 'false') : (string) $value) : '[object Object]'));
        $s = preg_replace('/[\x{0000}-\x{001f}\x{007f}\x{202a}-\x{202e}\x{2066}-\x{2069}]/u', '', $s) ?? $s;

        return Str::cut(Str::jsTrim($s), $max);
    }

    public static function phone(mixed $value): string
    {
        $p = preg_replace('/[^\d+]/', '', self::trim($value, 32));

        return preg_replace('/(?!^)\+/', '', $p);
    }

    private static function locale(mixed $v): string
    {
        return is_string($v) && isset(self::TEXT[$v]) ? $v : 'en';
    }

    private static function personalize(string $text, mixed $name): string
    {
        $parts = preg_split('/\s+/u', self::trim($name, 60));
        $first = $parts[0] ?? '';
        $text = preg_replace('/\{name\}/iu', $first, $text);
        $text = preg_replace('/\s{2,}/u', ' ', $text);
        $text = preg_replace('/\s+([,!?،؟.:])/u', '$1', $text);

        return Str::jsTrim($text);
    }

    private static function pickText(mixed $value, string $lang): string
    {
        foreach (self::PICK[$lang] ?? self::PICK['fr'] as $key) {
            $t = self::trim($value instanceof \stdClass ? ($value->{$key} ?? null) : null, 400);
            if ($t !== '') {
                return $t;
            }
        }

        return '';
    }

    private static function g(mixed $o, string $k): mixed
    {
        return $o instanceof \stdClass ? ($o->{$k} ?? null) : (is_array($o) ? ($o[$k] ?? null) : null);
    }

    /** event: request | lead | chat | ready | reply | campaign. `$request` is an object/array. */
    public static function payloadFor(mixed $request, mixed $language, string $event = 'request'): array
    {
        $lang = self::locale($language);
        $text = self::TEXT[$lang];
        $dir = in_array($lang, ['ar', 'dar'], true) ? 'rtl' : 'ltr';
        $id = self::g($request, 'id');
        $sid = is_string($id) ? $id : (is_scalar($id) ? (string) $id : '');
        $open = ['action' => 'open', 'title' => $text['open']];
        $call = ['action' => 'call', 'title' => $text['call']];
        if ($event === 'campaign') {
            $url = self::g($request, 'url');

            return [
                'title' => mb_substr(self::personalize(self::pickText(self::g($request, 'title'), $lang), self::g($request, 'name')), 0, 120),
                'body' => mb_substr(self::personalize(self::pickText(self::g($request, 'body'), $lang), self::g($request, 'name')), 0, 220),
                'requestId' => 'campaign-'.mb_substr($sid, 0, 80), 'phone' => '', 'lang' => $lang, 'dir' => $dir,
                'url' => is_string($url) && preg_match(self::CAMPAIGN_URL, $url) ? $url : '/', 'actions' => [$open],
            ];
        }
        if ($event === 'reply') {
            return ['title' => $text['reply'], 'body' => self::trim(self::g($request, 'text'), 120) ?: $text['replyBody'], 'requestId' => $sid, 'phone' => '', 'lang' => $lang, 'dir' => $dir, 'url' => '/chat/'.self::enc($sid), 'actions' => [$open]];
        }
        if ($event === 'chat') {
            $preview = self::trim(self::g($request, 'text'), 100) ?: '📷';

            return ['title' => $text['chat'], 'body' => (self::trim(self::g($request, 'name'), 60) ?: $text['guest']).': '.$preview, 'requestId' => $sid, 'phone' => self::phone(self::g($request, 'whatsapp')), 'lang' => $lang, 'dir' => $dir, 'url' => '/admin/chats?target='.self::enc($sid).'&open='.self::enc($sid), 'actions' => [$open, $call]];
        }
        if ($event === 'ready') {
            return ['title' => $text['ready'], 'body' => $text['readyBody'], 'requestId' => $sid, 'phone' => '', 'lang' => $lang, 'dir' => $dir, 'url' => '/history', 'actions' => [$open]];
        }
        $base = ['body' => self::trim(self::g($request, 'name'), 80).' - '.self::phone(self::g($request, 'whatsapp')), 'requestId' => $sid, 'phone' => self::phone(self::g($request, 'whatsapp')), 'lang' => $lang, 'dir' => $dir, 'actions' => [$open, $call]];
        if ($event === 'lead') {
            return ['title' => $text['lead']] + $base + ['url' => '/admin/users?target='.self::enc($sid)];
        }

        return ['title' => $text['title']] + $base + ['url' => '/admin/requests?target='.self::enc($sid).'&open='.self::enc($sid)];
    }

    /** encodeURIComponent */
    private static function enc(string $s): string
    {
        return strtr(rawurlencode($s), ['%21' => '!', '%2A' => '*', '%27' => "'", '%28' => '(', '%29' => ')']);
    }

    // ---- subscriptions ----

    /** @return array<string,mixed> validated subscriber; throws \InvalidArgumentException */
    public static function validateSubscription(mixed $input): array
    {
        $lang = self::locale(self::g($input, 'language'));
        if (self::g($input, 'kind') === 'fcm') {
            $token = self::g($input, 'token');
            if (! is_string($token) || strlen($token) < 20 || strlen($token) > 4096 || ! preg_match('/^[A-Za-z0-9_:\-]+$/D', $token)) {
                throw new \InvalidArgumentException('Invalid FCM token');
            }

            return ['id' => hash('sha256', $token), 'kind' => 'fcm', 'token' => $token, 'language' => $lang];
        }
        $value = self::g($input, 'subscription');
        $endpoint = self::g($value, 'endpoint');
        $u = is_string($endpoint) ? parse_url($endpoint) : false;
        if (! $u || ! isset($u['scheme'], $u['host'])) {
            throw new \InvalidArgumentException('Invalid subscription');
        }
        $host = strtolower($u['host']);
        $ok = in_array($host, ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'], true)
            || str_ends_with($host, '.push.services.mozilla.com') || str_ends_with($host, '.push.apple.com') || str_ends_with($host, '.notify.windows.com');
        if (strtolower($u['scheme']) !== 'https' || ! $ok || isset($u['user']) || isset($u['pass']) || isset($u['port']) || strlen($endpoint) > 2048) {
            throw new \InvalidArgumentException('Invalid push provider');
        }
        $keys = self::g($value, 'keys');
        foreach (['p256dh', 'auth'] as $k) {
            $kv = self::g($keys, $k);
            if (! is_string($kv) || ! preg_match('/^[A-Za-z0-9_-]+$/D', $kv)) {
                throw new \InvalidArgumentException('Invalid keys');
            }
        }
        $b64 = fn (string $s) => base64_decode(strtr($s, '-_', '+/').str_repeat('=', (4 - strlen($s) % 4) % 4), true) ?: '';
        $p = self::g($keys, 'p256dh');
        $a = self::g($keys, 'auth');
        if (strlen($b64($p)) !== 65 || strlen($b64($a)) !== 16) {
            throw new \InvalidArgumentException('Invalid key length');
        }
        // `href` of the WHATWG URL: lower-cased scheme/host, path "/" at least.
        $href = 'https://'.$host.($u['path'] ?? '/').(isset($u['query']) ? '?'.$u['query'] : '').(isset($u['fragment']) ? '#'.$u['fragment'] : '');

        return ['id' => hash('sha256', $href), 'kind' => 'web', 'subscription' => ['endpoint' => $href, 'keys' => ['p256dh' => $p, 'auth' => $a]], 'language' => $lang];
    }

    public function vapid(): array
    {
        if ($this->vapid) {
            return $this->vapid;
        }
        $subject = (string) config('dwira.vapid.subject', 'mailto:admin@example.com');
        $pub = config('dwira.vapid.public');
        $priv = config('dwira.vapid.private');
        if ($pub && $priv) {
            return $this->vapid = ['publicKey' => $pub, 'privateKey' => $priv, 'subject' => $subject];
        }
        $keys = $this->settings->secret('vapid');
        if (! is_array($keys) || empty($keys['publicKey'])) {
            $this->settings->putSecretIfAbsent('vapid', VAPID::createVapidKeys());
            $keys = $this->settings->secret('vapid');
        }

        return $this->vapid = ['publicKey' => $keys['publicKey'], 'privateKey' => $keys['privateKey'], 'subject' => $subject];
    }

    public function fcmConfigured(): bool
    {
        return $this->fcm !== null || (string) config('dwira.fcm_service_account_json') !== '';
    }

    public function config(): array
    {
        return ['publicKey' => $this->vapid()['publicKey'], 'web' => true, 'android' => $this->fcmConfigured()];
    }

    public function enabled(string $type): bool
    {
        $s = $this->content->getDoc('settings');
        $v = $type === 'client' ? ($s->notifyUsers ?? null) : ($s->notifyAdmins ?? null);

        return $v !== false;
    }

    /** @return list<array<string,mixed>> subscriber data + rowId */
    private function recipients(?array $audience): array
    {
        $audience ??= ['type' => 'admin'];
        if (! $this->enabled($audience['type'])) {
            return [];
        }
        if ($audience['type'] === 'client') {
            $rows = DB::table('subscriptions')->where('owner_type', 'client')->where('owner_id', $audience['id'])->get(['id', 'data', 'owner_id']);
            if ($rows->isEmpty()) {
                return [];
            }
            $prefs = Json::tryDecode(DB::table('clients')->where('id', $audience['id'])->value('prefs'));
            if ($prefs instanceof \stdClass && ($prefs->notifications ?? null) === false) {
                return [];
            }

            return $rows->map(fn ($r) => ['rowId' => $r->id] + (array) Json::tryDecode($r->data, new \stdClass))->all();
        }
        $rows = DB::table('subscriptions')->where('owner_type', 'admin')->get(['id', 'data', 'owner_id']);
        if ($rows->isEmpty()) {
            return [];
        }
        $off = [];
        foreach (DB::table('admin_prefs')->get(['admin_id', 'data']) as $p) {
            $d = Json::tryDecode($p->data);
            if ($d instanceof \stdClass && ($d->notifications ?? null) === false) {
                $off[$p->admin_id] = true;
            }
        }

        return $rows->filter(fn ($r) => ! isset($off[$r->owner_id]))->map(fn ($r) => ['rowId' => $r->id] + (array) Json::tryDecode($r->data, new \stdClass))->values()->all();
    }

    private function removeDevice(string $deviceId): void
    {
        DB::statement('DELETE FROM subscriptions WHERE COALESCE(device_id,id)=?', [$deviceId]);
    }

    /**
     * @param  list<string>  $completed
     * @return array{retry:bool,completed:list<string>,sent:int,devices:int}
     */
    public function deliver(mixed $request, array $completed = [], array $options = []): array
    {
        $done = array_flip($completed);
        $event = $options['event'] ?? 'request';
        $retry = false;
        $sent = 0;
        $targets = array_values(array_filter($this->recipients($options['audience'] ?? null), fn ($r) => ! isset($done[$r['rowId']])));
        foreach ($targets as $sub) {
            $payload = self::payloadFor($request, $sub['language'] ?? null, $event);
            try {
                if (($sub['kind'] ?? 'web') === 'fcm') {
                    ($this->fcmSender())($sub['token'], $payload);
                } else {
                    $this->sendWeb($sub['subscription'], Json::encode($payload));
                }
                $done[$sub['rowId']] = true;
                $sent++;
            } catch (\Throwable $e) {
                $status = (int) ($e->statusCode ?? $e->getCode());
                $code = $e->errorCode ?? null;
                $expired = $status === 410 || $status === 404 || $code === 'messaging/registration-token-not-registered';
                if ($expired) {
                    $this->removeDevice($sub['id'] ?? $sub['rowId']);
                    $done[$sub['rowId']] = true;
                } else {
                    $retry = true;
                }
                // Never log tokens, endpoints, payloads, names or phone numbers.
                Log::warning('Push failed', ['event' => $event, 'code' => $status ?: ($code ?: 'delivery-failed')]);
            }
        }

        return ['retry' => $retry, 'completed' => array_keys($done), 'sent' => $sent, 'devices' => count($targets)];
    }

    private function sendWeb(array $subscription, string $payload): void
    {
        if ($this->web) {
            ($this->web)($subscription, $payload, ['TTL' => 86400, 'urgency' => 'high', 'timeout' => 8]);

            return;
        }
        $v = $this->vapid();
        $push = new WebPush(['VAPID' => ['subject' => $v['subject'], 'publicKey' => $v['publicKey'], 'privateKey' => $v['privateKey']]], ['TTL' => 86400, 'urgency' => 'high'], 8);
        $report = $push->sendOneNotification(Subscription::create(['endpoint' => $subscription['endpoint'], 'publicKey' => $subscription['keys']['p256dh'], 'authToken' => $subscription['keys']['auth'], 'contentEncoding' => 'aes128gcm']), $payload);
        if (! $report->isSuccess()) {
            $status = $report->getResponse()?->getStatusCode() ?? 0;
            throw new PushFailure($status, null);
        }
    }

    private function fcmSender(): Closure
    {
        if ($this->fcm) {
            return $this->fcm;
        }
        $json = (string) config('dwira.fcm_service_account_json');
        if ($json === '') {
            throw new PushFailure(0, 'fcm-unconfigured');
        }

        return $this->fcm = new Fcm($json);
    }

    // ---- registry ----

    public function save(array $subscriber, array $owner = ['type' => 'admin', 'id' => 'admin']): void
    {
        DB::statement('INSERT INTO subscriptions(id,data,owner_type,owner_id,device_id) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data)', [
            $subscriber['id'].':'.$owner['type'].':'.$owner['id'], Json::encode($subscriber), $owner['type'], $owner['id'], $subscriber['id'],
        ]);
    }

    public function remove(string $deviceId, ?array $owner = null): void
    {
        if ($owner) {
            DB::statement('DELETE FROM subscriptions WHERE COALESCE(device_id,id)=? AND owner_type=? AND owner_id=?', [$deviceId, $owner['type'], $owner['id']]);
        } else {
            $this->removeDevice($deviceId);
        }
    }

    public function removeOwner(string $type, string $id): void
    {
        DB::table('subscriptions')->where('owner_type', $type)->where('owner_id', $id)->delete();
    }

    public function count(): int
    {
        return (int) DB::table('subscriptions')->where('owner_type', 'admin')->count();
    }

    public function clientSubscribers(): array
    {
        $by = [];
        foreach (DB::select("SELECT s.owner_id, s.data, c.name, c.phone, c.prefs FROM subscriptions s JOIN clients c ON c.id=s.owner_id WHERE s.owner_type='client'") as $r) {
            $prefs = Json::tryDecode($r->prefs);
            $e = $by[$r->owner_id] ?? ['id' => $r->owner_id, 'name' => $r->name, 'whatsapp' => $r->phone, 'off' => $prefs instanceof \stdClass && ($prefs->notifications ?? null) === false, 'browsers' => 0, 'apps' => 0];
            $d = Json::tryDecode($r->data);
            if ($d instanceof \stdClass && ($d->kind ?? null) === 'fcm') {
                $e['apps']++;
            } else {
                $e['browsers']++;
            }
            $by[$r->owner_id] = $e;
        }
        $on = $this->enabled('client');
        $list = [];
        foreach ($by as $e) {
            $off = $e['off'];
            unset($e['off']);
            $list[] = $e + ['devices' => $e['browsers'] + $e['apps'], 'status' => ! $on ? 'paused' : ($off ? 'off' : 'on')];
        }
        usort($list, fn ($a, $b) => strcmp((string) $a['name'], (string) $b['name']));

        return $list;
    }
}
