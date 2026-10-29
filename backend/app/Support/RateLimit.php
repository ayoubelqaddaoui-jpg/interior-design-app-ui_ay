<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;

/**
 * Fixed-window counter per `ip:bucket` (same semantics as the Node API: the window starts at the first hit and lasts
 * `rate.window` seconds). Uses the configured cache store (`file` on shared hosting: no extra table, no Redis).
 */
final class RateLimit
{
    /** @return bool true when the request is allowed */
    public static function hit(string $ip, string $bucket): bool
    {
        $limit = (int) config("dwira.rate.$bucket", config('dwira.rate.api'));
        $window = (int) config('dwira.rate.window');
        $key = 'rl:'.sha1($ip).':'.$bucket;
        $store = Cache::store();
        $store->add($key, 0, $window); // creates the window once
        $count = $store->increment($key);
        if ($count === false || $count === null) { // a store that cannot increment: fail open rather than lock everyone out
            return true;
        }

        return $count <= $limit;
    }

    public static function bucketFor(string $path): string
    {
        return match ($path) {
            '/api/admin/login' => 'login',
            '/api/sync' => 'sync',
            '/api/chat/reply' => 'chat',
            default => 'api',
        };
    }
}
