# Dwira on Hostinger shared hosting (Laravel + MySQL)

One Hostinger plan hosts everything: the Expo web app (static files), the Laravel API (`/api/*`), MySQL, the media files and
the background jobs (hPanel cron). No Node, no Docker, no queue worker.

```
/home/USER/domains/YOUR-DOMAIN/
  public_html/     <- web root: Expo export + .htaccess + _api.php   (the only PHP file that is public)
  laravel/         <- the API, OUTSIDE the web root: vendor/, .env, storage/ (media, logs, cache)
```

Everything below was prepared and tested in a sandbox (see "What was tested" at the end). The steps that need the real
Hostinger panel could not be run from here, so read the "Hostinger-specific" notes.

---------------------------------------------------------------------------------------------------------------------

## 0. What you need

| Item | Notes |
|---|---|
| Hostinger plan with **PHP 8.3 or newer**, **MySQL**, **cron jobs**, a domain with **SSL** | Premium / Business / Cloud all qualify. SSH is handy but not required (see 6.b). |
| A computer with **PHP 8.3+, Composer, zip** (and **Node 22** for the web export) | Only to build the upload. Nothing is built on the host. |
| Your old Postgres data | A **plain-format** `pg_dump` (see section 9). Skip for a fresh start. |

PHP extensions the API uses (all are on by default on Hostinger; check hPanel > Advanced > PHP Configuration > Extensions):
`pdo_mysql`, `mbstring`, `openssl`, `curl`, `fileinfo`, `gd` (WebP support), `sodium`, `intl`, `zip`.

## 1. Build the release (on your computer)

```bash
git clone https://github.com/ayoubelqaddaoui-jpg/interior-design-app-ui_ay.git && cd interior-design-app-ui_ay
backend/deploy/build-release.sh
```

This produces `release/public_html/`, `release/laravel/` and `release/dwira-<date>.zip` (the same content, zipped).
Same domain for site and API (recommended): no setting needed, the app calls `/api` on its own domain.
Only if the API lives on **another** domain: `API_URL=https://api.example.com/api backend/deploy/build-release.sh`
and put the site's origin in `APP_ORIGINS` (section 3).

What the script does: Expo web export, `composer install --no-dev --optimize-autoloader --classmap-authoritative`, copies the
right `.htaccess` files, leaves out tests, dev tools, your local `.env`, logs and uploaded media, and checks the result.

## 2. Create the database and set PHP (hPanel)

1. **Websites > Manage > PHP Configuration**: choose **PHP 8.3** (or newer). On the Options tab set
   `post_max_size = 128M`, `upload_max_filesize = 128M`, `memory_limit = 256M`, `max_execution_time = 60`
   (the release also ships a `.user.ini` with these values; use whichever your plan honours). Videos are uploaded as the raw
   request body, so `post_max_size` must be above `MEDIA_MAX_VIDEO_MB` (100 MB by default).
2. **Databases > Management**: create a MySQL database + user (strong password). Write down the database name, user, password
   (Hostinger prefixes them, e.g. `u123456789_dwira`). Host is `localhost` (use `127.0.0.1` if `localhost` fails).
3. **OPcache** is on by default on Hostinger. Nothing to do. (After every code upload, the cache refreshes within a few
   seconds; if you ever see old code, switch PHP version and back, or use "Clear cache" in hPanel.)

## 3. Upload

hPanel > **Files > File Manager** (or FTP/SFTP).

1. Make sure `public_html/` is empty (back up the old site first, see Rollback).
2. Upload `dwira-<date>.zip` to the folder **above** `public_html` (the domain folder), extract it. You now have
   `public_html/` and `laravel/` side by side. (If the zip would overwrite `public_html` contents, that is what you want.)
3. Check that **hidden files exist** in `public_html/` (enable "show hidden files" in File Manager): `.htaccess` and
   `.user.ini` must be there, and `public_html/_expo/static/.htaccess`, `public_html/assets/.htaccess`.
4. Folder permissions: folders `755`, files `644`. `laravel/storage` and `laravel/bootstrap/cache` must be writable by your
   user (they are, by default, on shared hosting; if not: `755`/`775`).

> If you can only place Laravel **inside** `public_html` (some plans have no folder above it), upload it as
> `public_html/laravel`. It still works: `_api.php` looks for `../laravel` and then `./laravel`, and `.htaccess` returns 404
> for `/laravel/*` (tested). Outside the web root is safer, so prefer it.

## 4. Configure `laravel/.env`

In File Manager, copy `laravel/.env.example` to `laravel/.env` and edit:

```ini
APP_ENV=production
APP_DEBUG=false                      # must stay false
APP_KEY=base64:...                   # generate: php artisan key:generate --show   (see 5). Back it up: it encrypts stored provider keys
APP_URL=https://your-domain.com
DB_HOST=localhost
DB_DATABASE=u123456789_dwira
DB_USERNAME=u123456789_dwira
DB_PASSWORD=...
ADMIN_EMAIL=you@your-domain.com      # there is NO default account; without both values nobody can sign in
ADMIN_PASSWORD_HASH='$argon2id$...'  # generate: php artisan dwira:admin-password   (keep the single quotes)
COOKIE_SECURE=true                   # the site must run on https
APP_ORIGINS=                         # empty for same domain; add https://other-origin only if you really need it
```

Other options (rate limits, media quality, FCM for Android push, AI keys, `CRON_SECRET`) are documented in `.env.example`.
**After any change to `.env`, run `php artisan config:cache` again** (config is cached for speed).

Generating the hash and key without SSH: run `php artisan key:generate --show` and `php artisan dwira:admin-password` on your
own computer in the `backend/` folder (or `php backend/tools/make-admin-hash.php`), paste the results into `.env`.

## 5. First run (SSH, or hPanel cron if you have no SSH)

**a) With SSH** (hPanel > Advanced > SSH Access):

```bash
cd ~/domains/YOUR-DOMAIN/laravel         # the folder that contains artisan
php -v                                    # must say 8.3+; if not: use /opt/alt/php83/usr/bin/php (or the path shown in hPanel)
php artisan migrate --force               # creates the 17 tables
php artisan config:cache && php artisan route:cache && php artisan view:cache
php artisan dwira:admin-password          # only if you did not hash the password yet
```

**b) Without SSH**: hPanel > **Advanced > Cron Jobs** > add a job set to run "once" (or every minute, then delete it after
it ran) with the command below, wait one minute, then delete the job:

```
cd /home/USER/domains/YOUR-DOMAIN/laravel && /usr/bin/php artisan migrate --force && /usr/bin/php artisan config:cache && /usr/bin/php artisan route:cache && /usr/bin/php artisan view:cache > /home/USER/first-run.log 2>&1
```

(Check `first-run.log`, then delete it. Use the PHP path hPanel shows for PHP 8.3 if `/usr/bin/php` is older.)

No `storage:link` is needed: media is served by the API itself from `laravel/storage/app/public/media` with long-lived cache headers.

## 6. Cron (background work)

hPanel > **Advanced > Cron Jobs**, **every minute** (`* * * * *`):

```
/usr/bin/php /home/USER/domains/YOUR-DOMAIN/laravel/artisan schedule:run >/dev/null 2>&1
```

This replaces the Node timer. One scheduled job (`dwira-background`) retries failed push notifications and runs the campaign
scheduler; inside each minute it loops about every 15 s, so latency stays close to the old backend. If your plan only allows
a few cron runs per hour, set `CRON_SECRET` in `.env` and call `https://your-domain.com/api/push/pump` from an external
scheduler with `Authorization: Bearer <secret>`.

Check it works: `php artisan schedule:list` shows `dwira-background`, and a push sent from the admin arrives within seconds
(it is also sent right after the request, the cron only retries what failed).

## 7. Smoke test

```bash
ADMIN_EMAIL=you@your-domain.com ADMIN_PASSWORD='your password' backend/deploy/smoke-test.sh https://your-domain.com
```

It checks the app shell, deep links, `/api/health` (`"runtime":"php"`, `adminConfigured:true`), ETag/304, admin login +
HttpOnly/Secure cookie, `admin/admin` refused, foreign origin refused (403), one media upload + cache headers, and that
`.env`, `laravel/`, `vendor/`, `_api.php`, `.git`, `.htaccess` are NOT reachable. Exit code 0 = all good.

Then open the site and sign in at `/admin`.

## 8. Performance notes (what is already done for you)

| Topic | What it does |
|---|---|
| Config / routes / views | cached by the three `*:cache` commands (section 5) |
| Autoloader | `--classmap-authoritative` (no file-system lookups) |
| `/api/content` | built once per content version, cached (file cache), `ETag` + `Cache-Control: s-maxage` -> repeat visits get `304` |
| `/api/sync` (polling) | anonymous = ONE tiny query; no session, no cookie work |
| Media | stored as WebP (+320/640 px thumbnails), `immutable` for a year, `?w=320|640` returns the thumbnail |
| Static app | `/_expo/*`, `/assets/*` immutable; `index.html` and `push-sw.js` always revalidated |
| Queue | none: work runs after the response is sent, cron retries the rest |
| Logs | `daily`, 7 days, level `warning`, secrets/tokens/bodies are never written |

If a page feels slow after a deploy: check PHP is 8.3+, the three caches exist (`laravel/bootstrap/cache/*.php`), and the
database is on `localhost` (not a remote host).

## 9. Move the existing data (Postgres -> MySQL)

1. On the old system export a **plain** dump (not `-Fc`, not `--inserts`):
   `pg_dump --no-owner --no-privileges --format=plain "$DATABASE_URL" | gzip > dwira.sql.gz`
2. Upload `dwira.sql.gz` to `laravel/storage/app/private/` (not into `public_html`).
3. Dry run, then the real import (SSH, or a one-off cron as in 5.b):

```bash
php artisan dwira:import-pg storage/app/private/dwira.sql.gz --dry-run
php artisan dwira:import-pg storage/app/private/dwira.sql.gz --fresh                       # media stored in the database
php artisan dwira:import-pg storage/app/private/dwira.sql.gz --fresh --r2-base=https://pub-xxxx.r2.dev   # media that lived in R2
```

The command prints per-table row counts (source vs target), primary-key set checks, orphan checks, missing media files and
dangling media links; it exits non-zero on any mismatch. Old media keeps its URL: `/api/media/<hash>.<ext>` works as before.
Admins sign in again (old admin sessions are not imported unless `--keep-admin-sessions`). Stored provider keys are
re-encrypted with the new `APP_KEY`.
Delete the dump from the server afterwards.

## 10. Android app and the frontend

- The Expo frontend is unchanged. The web build calls `/api` on the same domain.
- **Android**: the APK talks to the API URL that was baked in at build time (`EXPO_PUBLIC_API_URL`, default points to the old
  Vercel API). To use the new backend, set the repository variable `EXPO_PUBLIC_API_URL=https://your-domain.com/api` and build
  a new APK (see `docs/ANDROID_RELEASES.md`). Old APKs keep using the old API, so keep the old backend alive until users
  update, or ship the new APK first.
- **Admin login caveat**: `src/lib/backend.ts` still has the built-in `admin/admin` fallback: if the API is unreachable the app
  opens the admin screens in an *offline* mode. The server never accepts `admin/admin` (tested), so no data can be read or
  changed with it, but the UI opens. Removing it is a frontend change, which this migration deliberately did not make.

---------------------------------------------------------------------------------------------------------------------

## Test checklist (after every deploy)

- [ ] `https://your-domain.com/` loads; refresh on `/admin/requests` still loads the app
- [ ] `https://your-domain.com/api/health` -> `{"ok":true,"runtime":"php","database":"mysql",...,"adminConfigured":true}`
- [ ] `backend/deploy/smoke-test.sh` exits 0
- [ ] Admin sign-in works with your credentials, `admin/admin` is refused
- [ ] Edit something in the admin; open the site in a private window: the change is visible within ~30 s (content cache)
- [ ] Upload an image in the admin: it shows, URL is `/api/media/<hash>.<ext>`, second load is `304`/from cache
- [ ] Upload a video (> 8 MB): works (PHP limits OK)
- [ ] Create a request from the user side: it appears in the admin; a push notification arrives on an admin device
- [ ] hPanel cron shows a run every minute; `laravel/storage/logs/` has no repeating errors
- [ ] `/.env`, `/laravel/.env`, `/laravel/storage/logs/laravel.log`, `/vendor/autoload.php` return 404
- [ ] Android: a build with the new `EXPO_PUBLIC_API_URL` signs in and loads content
- [ ] After an import: counts printed by `dwira:import-pg` match, a sample of old media URLs still opens

## Rollback plan

Before the switch:

1. **Do not delete the old backend** (Vercel + Postgres + R2) until the checklist passed and a few days went by.
2. Back up what is on Hostinger now: File Manager > select `public_html` > Compress > download; export the old MySQL if any
   (hPanel > Databases > phpMyAdmin > Export).
3. Keep the `pg_dump` file and note the time it was taken: data written on the old system after that is not in MySQL.

Switching back (DNS/hosting level, takes minutes):

- *Domain moved to Hostinger*: point the domain's A record / nameservers back to the old host (Vercel). The old stack is untouched.
- *Same domain, bad release*: in File Manager rename `laravel` -> `laravel-bad` and restore the previous `laravel` folder
  (keep the last two release zips). The database is compatible across releases unless a release says otherwise; each release
  that changes the schema ships a new migration, never edits an old one, so you can also leave the DB alone.
- *Bad data import*: run it again with `--fresh` from the same dump, or restore the MySQL backup from phpMyAdmin.
- *Android*: old APKs still point at the old API, so they keep working as long as the old backend is up.

Data written to MySQL after the switch does **not** flow back to Postgres. If you must roll back after real users wrote data,
export it first (phpMyAdmin) and decide what to carry over by hand.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `/api/health` returns HTML (the app) | `.htaccess` missing in `public_html` (hidden file not uploaded) or `AllowOverride` disabled |
| `/api/health` 500, nothing in logs | wrong PHP version (<8.3), `laravel/vendor` missing, or `bootstrap/cache` / `storage` not writable |
| `/api/health` `"database":"error"` | wrong `DB_*` values; try `DB_HOST=127.0.0.1`; run `php artisan config:cache` after editing `.env` |
| Admin login always fails | `ADMIN_PASSWORD_HASH` not in single quotes (the `$` signs were eaten), or `config:cache` not re-run |
| Admin login works but cookie is lost | site is on http while `COOKIE_SECURE=true`; enable Force HTTPS in hPanel |
| 403 on API calls from a browser | the page is served from an origin not in `APP_ORIGINS` (e.g. `www.` vs bare domain: add the other one or redirect it) |
| Big upload fails with 413 | `post_max_size` / `upload_max_filesize` below the file size (section 2) |
| Images not WebP | PHP `gd` without WebP support: enable the `gd` extension (hPanel) |
| Pushes do not retry | cron missing; `php artisan schedule:list` must show `dwira-background` |
| Old content after an edit | `/api/content` is cached up to `CONTENT_S_MAXAGE` seconds by CDNs/browsers (default 30) |

## What was tested, and what was not

Tested in the sandbox (PHP 8.4.27, MariaDB 11, Apache 2.4.69 with mod_rewrite/mod_headers/mod_php, Postgres 17 as the reference):

- `php artisan test`: 69 tests (API flow, schema, ApiGate, importer, campaign rules vs Node fixtures, SSRF downloader, images, notifier).
- Contract harness: the same 153 requests against the original Node API and the Laravel API -> identical.
- The built release (`build-release.sh`: `composer --no-dev`, caches, no tests/`.env`) served by a real Apache with the shipped
  `.htaccess`: 35/35 smoke checks (routing, deep links, 404 for missing assets, cache headers, blocked paths, login, cookie flags,
  upload/serve/304, 20 MB raw body, `schedule:run` executing the background job).
- `pg_dump` -> MySQL import with real `pg_dump` output and count/PK/orphan checks.

NOT tested (cannot be from here), so verify on the real host with sections 5-7:

- Hostinger itself: LiteSpeed (it reads the same `.htaccess` rules, but this is unproven), hPanel cron/PHP-selector behaviour, CloudLinux limits (CPU/entry processes), file permissions.
- PHP 8.3 specifically (tests ran on 8.4; the code and `composer.lock` target 8.3 and `composer check-platform-reqs` passed) and MySQL 8 itself (tests ran on MariaDB).
- Real Web Push / FCM delivery (fake senders only), real R2 downloads, large dumps (GBs of media), and the Expo export inside the build script (it is the unchanged `npm run build:web`; the test used a small stand-in `dist/`).
- Load: no benchmark on shared hosting. The design keeps the hot paths to one query / one cached file.
