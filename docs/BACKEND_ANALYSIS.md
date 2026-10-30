# Analysis of the existing Node API (`server/`)

This is the contract the Laravel backend (`backend/`) has to honour. It was written by reading every file of `server/`
(`index.js`, `db.js`, `clients.js`, `content.js`, `sync.js`, `media.js`, `remote-media.js`, `notifications.js`,
`campaigns.js`, `chat.js`, `translate.js`, `compress.js`, `password.js`) plus the client code that calls it
(`src/lib/backend.ts`, `src/lib/sync.ts`, `src/lib/media.ts`).

## 1. Transport rules (apply to every `/api/*` request)

| Rule | Behaviour |
|---|---|
| Errors | `{ "error": "<message>" }` with the status; unexpected errors are `500 {"error":"Server error"}`; unknown route/method `404 "API route not found"`. |
| Bodies | JSON only: wrong `Content-Type` -> `415 JSON required`, bad JSON `400 Invalid JSON`, > 4 MB `413 Request too large`. |
| Headers | `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on JSON. |
| CORS | Same-origin always allowed. Other `Origin` must be in `APP_ORIGINS`, else `403 Origin not allowed`. Allowed origins get `Access-Control-Allow-Origin: <origin>`, `Allow-Credentials: true`, `Vary: Origin`. `OPTIONS` -> `204`. Allowed headers: `Content-Type, Authorization, X-Demand-Token, X-Dwira-Native, X-User-Token`. |
| Rate limit | Fixed 15-minute window per `ip:bucket`. Buckets: `login` 20, `sync` 20000, `chat` (`CHAT_RATE_LIMIT`, 90), `api` (`API_RATE_LIMIT`, >= 300). `429 Too many requests`. `GET/HEAD /api/media/*` is exempt. |
| Cookies | `dwira_admin` (7 days) and `dwira_user` (365 days): `HttpOnly; SameSite=Strict; Path=/api; Max-Age=..; Secure` (Secure unless `COOKIE_SECURE=false`). |
| Native clients | Send `X-Dwira-Native: 1`; login responses then include `token`; they send `Authorization: Bearer <admin token>` and `X-User-Token`. |
| Device identity | `X-Demand-Token`: 64 hex chars, only its SHA-256 is stored (guest chats, request ownership proof, sync). |

## 2. Identities

* **Admin session** - token (cookie or `Authorization: Bearer`), stored as SHA-256 in `admin_sessions` (7 days, `admin_id`).
  Login `POST /api/admin/login {email,password}`; the Node code also accepted the built-in `admin` / `admin` unless
  `DISABLE_DEFAULT_ADMIN=true`, or `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` (`salt:scrypt(64)` hex). **The Laravel API has no default account.**
* **Client session** - phone-number login (`POST /api/user/login {name, phone}`), no password. 365-day token (cookie or `X-User-Token`),
  stored as SHA-256 in `user_sessions`. Phone canonicalised to `+<digits>` (Moroccan `06/07/05...` -> `+212...`). New clients start with
  `settings.defaultFreeCredits`. `last_seen` refreshed at most every 5 min by any authenticated call.
* **Visitor** - only `X-Demand-Token`; may keep AI-chat conversations (`guest_chats`, max 30) that move to the client on login.

## 3. Routes (all under `/api`)

| Method + path | Auth | Notes |
|---|---|---|
| `GET /health` | - | `{ok, runtime, database, media, adminConfigured}`; 503 if DB down |
| `GET /content` | public (`?a=1` or token = admin copy with provider keys) | snapshot `{version, collections, docs}`; `Cache-Control: public, max-age=0, s-maxage=30, stale-while-revalidate=300` for public |
| `GET /sync` | any | versions `{content, campaigns, requests, clients, chats, admin, client, guest, user, isAdmin}` - polled every 4 s by every open app |
| `GET/PATCH /prefs[?as=admin]` | client / admin | `notifications`, `bannerDismissed`, `lang` (`dar|ar|fr`) |
| `POST /user/login`, `GET /user/session`, `POST /user/logout`, `POST /user/claim` | - / client | claim = atomic spend of the free or a paid credit, idempotent per claim id (`402 PRO_REQUIRED`) |
| `GET /user/requests` | client | own render requests |
| `GET|POST /user/(history|conversations)`, `GET|PATCH|DELETE .../:id` | client | per-client JSON "space"; history POST needs a prior claim (`403 CLAIM_REQUIRED`); conversation writes notify admins |
| `GET|POST /guest/conversations`, `GET|PATCH|DELETE .../:id` | device token | visitors' chats; `409 ALREADY_SIGNED_IN` when a client session exists |
| `POST /chat/reply` | client/device | AI answer through Gemini -> Groq -> OpenRouter -> Pollinations |
| `POST /requests`, `GET /requests`, `GET|PATCH|DELETE /requests/:id` | client / admin | render requests (idempotent per client + request id); status `pending|processing|delivered` |
| `GET /admin/clients`, `POST /admin/clients/bulk`, `PATCH|DELETE /admin/clients/:id` | admin | credits (shown balance = credits + unused free), block, delete |
| `GET /admin/conversations`, `POST /admin/conversations/:id` | admin | admin reply is stored as a server-owned `admin` message and pushed to the client |
| `GET /admin/notification-subscribers` | admin | |
| `GET/POST /admin/campaigns`, `GET/PATCH/DELETE /admin/campaigns/:id`, `POST .../activate|pause|duplicate`, `GET segments|people`, `POST preview|test` | admin | push campaigns: once / recurring / trigger |
| `GET /admin/chat/status`, `PATCH /admin/chat/keys` | admin | provider keys are write-only |
| `PUT /admin/content/:coll/:id`, `DELETE /admin/content/:coll {ids}`, `PATCH /admin/doc/:name` | admin | content; each write bumps the `content` version |
| `POST /admin/translate` | admin | fr/ar/dar through Pollinations then MyMemory |
| `POST /admin/media`, `/raw`, `/import`, `/presign`, `/complete` | admin | uploads (see media) |
| `POST /admin/login`, `GET /admin/session`, `POST /admin/logout` | - / admin | |
| `GET /push/config`, `POST|DELETE /push/subscriptions`, `POST /push/test`, `GET|POST /push/pump` | - / admin / cron secret | web-push (VAPID) + FCM v1 |
| `GET|HEAD /media/<32hex>.<ext>` | public | immutable, 1 year |

## 4. Database (Postgres -> MySQL)

`clients, user_sessions, claims, space, admin_sessions, requests, subscriptions, outbox, settings, content_items, content_docs,
admin_prefs, sync_state, media, guest_chats, campaigns, campaign_deliveries`. Timestamps are epoch **milliseconds** (BIGINT),
documents are JSON stored as TEXT (kept as text in MySQL, not `JSON`, so key order is preserved byte for byte).
Foreign keys with `ON DELETE CASCADE`: `user_sessions`, `claims`, `space`, `campaign_deliveries` -> `clients`;
`campaign_deliveries` -> `campaigns`. `requests.user_id` is **not** a foreign key (requests outlive a deleted client).

## 5. Sync

`sync_state(key, version)` is a set of counters. Every mutation bumps keys (`content`, `requests`, `clients`, `chats`, `campaigns`,
`c:<clientId>`, `a:<adminId>`, `g:<deviceHash>`); apps poll `/api/sync` every 4 s while visible and refetch only what changed.
In Node every poll also (a) retried the notification outbox and (b) ticked the campaign scheduler - the expensive part. The Laravel
version moves both to cron.

## 6. Media

`storeMedia` is content-addressed: id = first 32 hex of `sha256(base64(bytes))`, URL `/api/media/<id>.<ext>`. Images arrive as data URLs
(`POST /admin/media`), raw bodies (`/raw`), external URLs (`/import`, SSRF-hardened downloader) or presigned PUTs to R2 (`/presign`,`/complete`).
Magic-byte sniffing decides the real type (png jpg gif webp avif svg mp4 webm mov); SVG only for admin content. Content rows must hold
`/api/media/...` URLs, never base64: `externalize()` walks any JSON and replaces data URLs and (under keys `image, cover, poster, logoUri,
loaderCustomUri, photoUri, aiResult, finalResult, before, after, uri`) external https URLs. Absolute `https://host/api/media/..` URLs from native
clients are stored host-independent. Storage was R2 (redirect 302) or Postgres (bytea / legacy base64).

## 7. Push + campaigns

* Web push (VAPID keys generated once and stored in `settings.vapid`) and Android FCM HTTP v1 (service-account JWT).
* `outbox(request_id, kind, payload, attempts, next_at, completed)` - jobs `request|lead|chat|ready|reply`, 60 s lease, 6 attempts, exponential backoff.
* Campaigns: `campaigns` + `campaign_deliveries` (PK = idempotency key). `tick()` = materialise due campaigns -> evaluate triggers -> deliver due rows -> finalise;
  throttled to once per 10 s, driven by polls, a Node timer and the daily Vercel cron `GET /api/push/pump`.

## 8. Cron jobs

Only one: `vercel.json` `crons: /api/push/pump` daily 06:00 (`Authorization: Bearer $CRON_SECRET`) - flushes the outbox and ticks campaigns.
Everything else relied on polls and the 15 s Node timer. On Hostinger this becomes `* * * * * php artisan schedule:run` (hPanel cron, 1-minute granularity).

## 9. Things that are easy to get wrong (and are covered by tests)

* `{}` must stay `{}` (never `[]`), key order of stored documents must survive a round-trip.
* Admin replies are server-owned: a client write can never delete or forge `role: admin` messages.
* `clients` credit maths: shown credits = `credits + (free_used ? 0 : 1)`; target 0 also consumes the free design.
* `PATCH /requests/:id` allows clients only `aiResult`, `historyId` (+ the guarded auto-send), admins everything.
* Error precedence: e.g. `POST /push/subscriptions` parses the body (415/400) *before* the auth check (401).
