<?php

namespace App\Services;

use App\Support\Json;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

/**
 * The `settings` key/value table (vapid keys, provider keys, scheduler throttle). Secrets are encrypted with APP_KEY
 * ("enc:" prefix); plain values written by the Postgres import are still readable and are re-encrypted on next write.
 */
final class Settings
{
    public function get(string $key): ?string
    {
        $row = DB::table('settings')->where('key', $key)->first();

        return $row?->value;
    }

    public function put(string $key, string $value): void
    {
        DB::statement('INSERT INTO settings(`key`, value) VALUES(?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)', [$key, $value]);
    }

    public function putIfAbsent(string $key, string $value): bool
    {
        return Db::insertIfAbsent('settings', ['key' => $key, 'value' => $value]);
    }

    public function secret(string $key): mixed
    {
        $raw = $this->get($key);
        if ($raw === null) {
            return null;
        }
        if (str_starts_with($raw, 'enc:')) {
            try {
                return Json::tryDecode(Crypt::decryptString(substr($raw, 4)));
            } catch (\Throwable) {
                return null; // APP_KEY changed: treated as "not configured" rather than a crash
            }
        }

        return Json::tryDecode($raw);
    }

    public function putSecret(string $key, mixed $value): void
    {
        $this->put($key, 'enc:'.Crypt::encryptString(Json::encode($value)));
    }
}
