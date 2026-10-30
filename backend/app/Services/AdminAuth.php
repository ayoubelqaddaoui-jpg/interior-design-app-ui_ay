<?php

namespace App\Services;

use App\Support\Str;
use Illuminate\Support\Facades\DB;

/**
 * Admin login. There is NO built-in account: ADMIN_EMAIL + ADMIN_PASSWORD_HASH must be configured.
 * Accepted hash formats: argon2id / bcrypt (`php artisan dwira:admin-password`) and the legacy Node format "salt:scrypt-hex".
 */
final class AdminAuth
{
    /** Returns the stable admin identity (lower-cased email) or null. */
    public function identity(string $email, string $password): ?string
    {
        $configured = (string) config('dwira.admin.email');
        $hash = (string) config('dwira.admin.password_hash');
        $user = mb_strtolower(Str::jsTrim($email));
        // Always run a verification (even for a wrong email) so timing does not reveal whether the email matched.
        $okPassword = self::verify($password, $hash);

        return $configured !== '' && $hash !== '' && hash_equals(mb_strtolower($configured), $user) && $okPassword ? $user : null;
    }

    public static function verify(string $password, string $encoded): bool
    {
        if ($encoded === '') {
            password_verify($password, '$2y$10$'.str_repeat('a', 53)); // constant-ish work

            return false;
        }
        if (str_starts_with($encoded, '$')) {
            return password_verify($password, $encoded);
        }
        // legacy: "<salt>:<128 hex>" = scrypt(password, salt, 64) with N=16384, r=8, p=1 (Node defaults)
        [$salt, $digest] = array_pad(explode(':', $encoded, 2), 2, '');
        if ($salt === '' || ! preg_match('/^[a-f0-9]{128}$/D', $digest)) {
            return false;
        }
        $calc = self::scrypt($password, $salt, 64);

        return $calc !== null && hash_equals($digest, bin2hex($calc));
    }

    /** scrypt via PHP's openssl_pbkdf2-free route: ext-sodium has no generic scrypt, so use the pure-PHP fallback when needed. */
    private static function scrypt(string $password, string $salt, int $length): ?string
    {
        if (function_exists('scrypt')) {
            return hex2bin(scrypt($password, $salt, 16384, 8, 1, $length));
        }

        return self::scryptPhp($password, $salt, 16384, 8, 1, $length);
    }

    /** Minimal RFC 7914 scrypt (only used to verify an imported legacy hash, so speed is not critical). */
    private static function scryptPhp(string $password, string $salt, int $N, int $r, int $p, int $dkLen): string
    {
        $B = hash_pbkdf2('sha256', $password, $salt, 1, $p * 128 * $r, true);
        $blocks = str_split($B, 128 * $r);
        foreach ($blocks as $i => $block) {
            $blocks[$i] = self::roMix($block, $N, $r);
        }

        return hash_pbkdf2('sha256', $password, implode('', $blocks), 1, $dkLen, true);
    }

    private static function roMix(string $B, int $N, int $r): string
    {
        $x = array_values(unpack('V*', $B));
        $V = [];
        for ($i = 0; $i < $N; $i++) {
            $V[$i] = $x;
            $x = self::blockMix($x, $r);
        }
        $words = 32 * $r;
        for ($i = 0; $i < $N; $i++) {
            $j = $x[($words - 16)] & ($N - 1);
            $v = $V[$j];
            for ($k = 0; $k < $words; $k++) {
                $x[$k] ^= $v[$k];
            }
            $x = self::blockMix($x, $r);
        }

        return pack('V*', ...$x);
    }

    private static function blockMix(array $B, int $r): array
    {
        $X = array_slice($B, (2 * $r - 1) * 16, 16);
        $Y = [];
        for ($i = 0; $i < 2 * $r; $i++) {
            for ($k = 0; $k < 16; $k++) {
                $X[$k] ^= $B[$i * 16 + $k];
            }
            $X = self::salsa8($X);
            $Y[$i] = $X;
        }
        $out = [];
        for ($i = 0; $i < $r; $i++) {
            array_push($out, ...$Y[2 * $i]);
        }
        for ($i = 0; $i < $r; $i++) {
            array_push($out, ...$Y[2 * $i + 1]);
        }

        return $out;
    }

    private static function salsa8(array $in): array
    {
        $x = $in;
        $rotl = static fn (int $a, int $b): int => (($a << $b) | ($a >> (32 - $b))) & 0xFFFFFFFF;
        for ($i = 0; $i < 8; $i += 2) {
            $x[4] ^= $rotl(($x[0] + $x[12]) & 0xFFFFFFFF, 7);
            $x[8] ^= $rotl(($x[4] + $x[0]) & 0xFFFFFFFF, 9);
            $x[12] ^= $rotl(($x[8] + $x[4]) & 0xFFFFFFFF, 13);
            $x[0] ^= $rotl(($x[12] + $x[8]) & 0xFFFFFFFF, 18);
            $x[9] ^= $rotl(($x[5] + $x[1]) & 0xFFFFFFFF, 7);
            $x[13] ^= $rotl(($x[9] + $x[5]) & 0xFFFFFFFF, 9);
            $x[1] ^= $rotl(($x[13] + $x[9]) & 0xFFFFFFFF, 13);
            $x[5] ^= $rotl(($x[1] + $x[13]) & 0xFFFFFFFF, 18);
            $x[14] ^= $rotl(($x[10] + $x[6]) & 0xFFFFFFFF, 7);
            $x[2] ^= $rotl(($x[14] + $x[10]) & 0xFFFFFFFF, 9);
            $x[6] ^= $rotl(($x[2] + $x[14]) & 0xFFFFFFFF, 13);
            $x[10] ^= $rotl(($x[6] + $x[2]) & 0xFFFFFFFF, 18);
            $x[3] ^= $rotl(($x[15] + $x[11]) & 0xFFFFFFFF, 7);
            $x[7] ^= $rotl(($x[3] + $x[15]) & 0xFFFFFFFF, 9);
            $x[11] ^= $rotl(($x[7] + $x[3]) & 0xFFFFFFFF, 13);
            $x[15] ^= $rotl(($x[11] + $x[7]) & 0xFFFFFFFF, 18);
            $x[1] ^= $rotl(($x[0] + $x[3]) & 0xFFFFFFFF, 7);
            $x[2] ^= $rotl(($x[1] + $x[0]) & 0xFFFFFFFF, 9);
            $x[3] ^= $rotl(($x[2] + $x[1]) & 0xFFFFFFFF, 13);
            $x[0] ^= $rotl(($x[3] + $x[2]) & 0xFFFFFFFF, 18);
            $x[6] ^= $rotl(($x[5] + $x[4]) & 0xFFFFFFFF, 7);
            $x[7] ^= $rotl(($x[6] + $x[5]) & 0xFFFFFFFF, 9);
            $x[4] ^= $rotl(($x[7] + $x[6]) & 0xFFFFFFFF, 13);
            $x[5] ^= $rotl(($x[4] + $x[7]) & 0xFFFFFFFF, 18);
            $x[11] ^= $rotl(($x[10] + $x[9]) & 0xFFFFFFFF, 7);
            $x[8] ^= $rotl(($x[11] + $x[10]) & 0xFFFFFFFF, 9);
            $x[9] ^= $rotl(($x[8] + $x[11]) & 0xFFFFFFFF, 13);
            $x[10] ^= $rotl(($x[9] + $x[8]) & 0xFFFFFFFF, 18);
            $x[12] ^= $rotl(($x[15] + $x[14]) & 0xFFFFFFFF, 7);
            $x[13] ^= $rotl(($x[12] + $x[15]) & 0xFFFFFFFF, 9);
            $x[14] ^= $rotl(($x[13] + $x[12]) & 0xFFFFFFFF, 13);
            $x[15] ^= $rotl(($x[14] + $x[13]) & 0xFFFFFFFF, 18);
        }
        $out = [];
        for ($i = 0; $i < 16; $i++) {
            $out[$i] = ($x[$i] + $in[$i]) & 0xFFFFFFFF;
        }

        return $out;
    }

    /** Create a session; returns the raw token (only its sha256 is stored). */
    public function createSession(string $identity): string
    {
        $token = bin2hex(random_bytes(32));
        $now = now_ms();
        DB::table('admin_sessions')->where('expires_at', '<=', $now)->delete();
        DB::table('admin_sessions')->insert(['token_hash' => Str::sha256($token), 'expires_at' => $now + (int) config('dwira.admin.session_days', 7) * 86400000, 'admin_id' => $identity]);

        return $token;
    }
}
