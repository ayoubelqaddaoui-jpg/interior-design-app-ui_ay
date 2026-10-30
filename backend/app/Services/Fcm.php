<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/** FCM HTTP v1 without a Google SDK: service-account JWT -> OAuth token -> REST send (port of createFcm). */
final class Fcm
{
    private ?array $account = null;

    public function __construct(private readonly string $json)
    {
    }

    private function account(): array
    {
        return $this->account ??= (array) json_decode($this->json, true, 512, JSON_THROW_ON_ERROR);
    }

    private static function b64(string $s): string
    {
        return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
    }

    private function accessToken(): string
    {
        $cached = Cache::get('fcm:token');
        if (is_array($cached) && $cached['expires'] > time() + 60) {
            return $cached['token'];
        }
        $key = $this->account();
        $now = time();
        $unsigned = self::b64(json_encode(['alg' => 'RS256', 'typ' => 'JWT'])).'.'.self::b64(json_encode(['iss' => $key['client_email'], 'scope' => 'https://www.googleapis.com/auth/firebase.messaging', 'aud' => 'https://oauth2.googleapis.com/token', 'iat' => $now, 'exp' => $now + 3300]));
        openssl_sign($unsigned, $sig, $key['private_key'], OPENSSL_ALGO_SHA256);
        $res = Http::asForm()->timeout(8)->post('https://oauth2.googleapis.com/token', ['grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion' => $unsigned.'.'.self::b64($sig)]);
        if (! $res->ok()) {
            throw new PushFailure($res->status(), 'fcm-auth');
        }
        $token = (string) $res->json('access_token');
        Cache::put('fcm:token', ['token' => $token, 'expires' => $now + (int) ($res->json('expires_in') ?: 3300)], 3300);

        return $token;
    }

    public function __invoke(string $token, array $payload): void
    {
        $res = Http::withToken($this->accessToken())->timeout(8)->post('https://fcm.googleapis.com/v1/projects/'.$this->account()['project_id'].'/messages:send', ['message' => [
            'token' => $token,
            'notification' => ['title' => $payload['title'], 'body' => $payload['body']],
            'data' => ['url' => $payload['url'], 'phone' => $payload['phone'], 'requestId' => $payload['requestId'], 'categoryId' => 'demands', 'language' => $payload['lang']],
            'android' => ['priority' => 'HIGH', 'ttl' => '86400s', 'notification' => ['channel_id' => 'demands', 'tag' => $payload['requestId']]],
        ]]);
        if (! $res->successful()) {
            $err = $res->json('error') ?: [];
            $status = null;
            foreach ($err['details'] ?? [] as $d) {
                if (! empty($d['errorCode'])) {
                    $status = $d['errorCode'];
                    break;
                }
            }
            $status ??= $err['status'] ?? null;
            throw new PushFailure($res->status(), in_array($status, ['UNREGISTERED', 'INVALID_ARGUMENT'], true) ? 'messaging/registration-token-not-registered' : $status);
        }
    }
}
