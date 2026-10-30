<?php

namespace App\Support;

use App\Services\Clients;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Who is calling: the admin session, the signed-in client and the device token of ONE request, each looked up lazily and
 * at most once (the Node API resolved them eagerly on every call; /api/sync for an anonymous visitor now costs 1 query).
 */
final class Ctx
{
    private bool $adminLoaded = false;
    private ?object $adminRow = null;
    private bool $clientLoaded = false;
    private ?array $client = null;

    public function __construct(public readonly Request $request)
    {
    }

    public static function of(Request $request): self
    {
        $ctx = $request->attributes->get('ctx');
        if (! $ctx instanceof self) {
            $ctx = new self($request);
            $request->attributes->set('ctx', $ctx);
        }

        return $ctx;
    }

    /** Raw cookie value exactly as the Node API read it (split on `;`, no decoding). */
    public function cookie(string $name): ?string
    {
        $header = $this->request->headers->get('Cookie');
        if ($header === null) {
            return null;
        }
        foreach (explode(';', $header) as $part) {
            $part = trim($part);
            if (str_starts_with($part, $name.'=')) {
                return substr($part, strlen($name) + 1);
            }
        }

        return null;
    }

    /** `Authorization: Bearer <token>` or the `dwira_admin` cookie (empty strings count as absent). */
    public function sessionToken(): ?string
    {
        $auth = $this->request->headers->get('Authorization');
        if ($auth !== null && $auth !== '') {
            $token = preg_replace('/^Bearer /', '', $auth, 1);
            if ($token !== '' && $token !== null) {
                return $token;
            }
        }
        $cookie = $this->cookie('dwira_admin');

        return $cookie === null || $cookie === '' ? null : $cookie;
    }

    /** The live admin session row {token_hash, admin_id} or null. */
    public function adminSession(): ?object
    {
        if (! $this->adminLoaded) {
            $this->adminLoaded = true;
            $token = $this->sessionToken();
            $this->adminRow = $token === null ? null : DB::table('admin_sessions')->select('token_hash', 'admin_id')
                ->where('token_hash', Str::sha256($token))->where('expires_at', '>', now_ms())->first();
        }

        return $this->adminRow;
    }

    public function adminId(): ?string
    {
        return $this->adminSession()?->admin_id;
    }

    public function requireAdmin(): void
    {
        if (! $this->adminSession()) {
            throw fail(401, 'Admin login required');
        }
    }

    /** SHA-256 of the 64-hex `X-Demand-Token` device token, or null. */
    public function clientHash(): ?string
    {
        $token = $this->request->headers->get('X-Demand-Token');

        return is_string($token) && preg_match('/^[a-f0-9]{64}$/D', $token) ? Str::sha256($token) : null;
    }

    public function userToken(): ?string
    {
        $header = $this->request->headers->get('X-User-Token');
        if ($header !== null && $header !== '') {
            return $header;
        }
        $cookie = $this->cookie('dwira_user');

        return $cookie === '' ? null : $cookie;
    }

    /** The signed-in client (public user array incl. `blocked`) or null. */
    public function client(): ?array
    {
        if (! $this->clientLoaded) {
            $this->clientLoaded = true;
            $this->client = app(Clients::class)->authenticate($this->userToken());
        }

        return $this->client;
    }

    public function requireUser(): array
    {
        $client = $this->client();
        if (! $client) {
            throw fail(401, 'USER_LOGIN_REQUIRED');
        }
        if ($client['blocked']) {
            throw fail(403, 'ACCOUNT_BLOCKED');
        }

        return $client;
    }

    public function native(): bool
    {
        return $this->request->headers->get('X-Dwira-Native') === '1';
    }
}
