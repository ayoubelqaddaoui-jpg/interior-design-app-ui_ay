#!/usr/bin/env bash
# Post-deploy smoke test. Safe to run on production (reads only; with ADMIN_* it also logs in and uploads one 1x1 PNG).
#
#   backend/deploy/smoke-test.sh https://your-domain.com
#   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' backend/deploy/smoke-test.sh https://your-domain.com
#
# Exit code 0 = every check passed.
set -u
BASE="${1:-}"; [ -n "$BASE" ] || { echo "usage: $0 https://your-domain.com"; exit 2; }
BASE="${BASE%/}"
PASS=0; FAIL=0
JAR="$(mktemp)"; trap 'rm -f "$JAR"' EXIT
ok()   { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m %s\n' "$1"; }
code() { curl -sk -o /dev/null -w '%{http_code}' "$@"; }
status() { # desc want path [curl args]
  local d="$1" w="$2" p="$3"; shift 3; local g; g="$(code "$@" "$BASE$p")"
  [ "$g" = "$w" ] && ok "$d ($p -> $g)" || bad "$d ($p -> $g, expected $w)"
}
header() { # desc path regex
  curl -sk -D- -o /dev/null "$BASE$2" | tr -d '\r' | grep -qiE "$3" && ok "$1" || bad "$1 (no header matching: $3)"
}

echo "== Static app"
status "home page" 200 /
status "deep link falls back to the app" 200 /admin/requests
curl -sk "$BASE/history" | grep -qiE '<html|<!doctype html' && ok "deep link returns HTML" || bad "deep link does not return HTML"
header "index.html is revalidated" / 'cache-control:.*(no-cache|max-age=0)'
status "push service worker" 200 /push-sw.js
header "service worker scope" /push-sw.js 'service-worker-allowed: /'
status "missing script is a 404, not the app shell" 404 /_expo/static/js/web/does-not-exist.js

echo "== API"
H="$(curl -sk "$BASE/api/health")"
echo "$H" | grep -q '"ok":true' && ok "health ok: $H" || bad "health: $H"
echo "$H" | grep -q '"runtime":"php"' && ok "answered by the PHP backend" || bad "not the PHP backend (is /api routed to _api.php?)"
echo "$H" | grep -q '"adminConfigured":true' && ok "admin credentials configured" || bad "ADMIN_EMAIL / ADMIN_PASSWORD_HASH missing in laravel/.env"
status "unknown API route is a JSON 404" 404 /api/does-not-exist
status "public content" 200 /api/content
header "content has an ETag" /api/content '^etag:'
E="$(curl -sk -D- -o /dev/null "$BASE/api/content" | tr -d '\r' | awk -F': ' 'tolower($1)=="etag"{print $2}')"
[ -n "$E" ] && [ "$(code -H "If-None-Match: $E" "$BASE/api/content")" = "304" ] && ok "conditional GET returns 304" || bad "ETag revalidation does not return 304"
status "sync endpoint" 200 /api/sync
status "admin area needs a login" 401 /api/admin/session
status "admin/admin is refused" 401 /api/admin/login -H 'Content-Type: application/json' -d '{"email":"admin","password":"admin"}'
status "foreign origin is refused" 403 /api/admin/login -H 'Origin: https://evil.example' -H 'Content-Type: application/json' -d '{}'
header "nosniff on the API" /api/health 'x-content-type-options: nosniff'

echo "== Things that must NOT be reachable"
for p in /.env /laravel/.env /laravel/.env.example /laravel/storage/logs/laravel.log /laravel/vendor/autoload.php /vendor/autoload.php /_api.php /.git/config /.htaccess /.user.ini; do
  g="$(code "$BASE$p")"; { [ "$g" = "404" ] || [ "$g" = "403" ]; } && ok "blocked $p ($g)" || bad "$p is reachable ($g)"
done

if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  echo "== Admin (logs in, uploads one 1x1 image)"
  BODY="$(php -r 'echo json_encode(["email"=>getenv("ADMIN_EMAIL"),"password"=>getenv("ADMIN_PASSWORD")]);' 2>/dev/null || printf '{"email":"%s","password":"%s"}' "$ADMIN_EMAIL" "$ADMIN_PASSWORD")"
  g="$(curl -sk -c "$JAR" -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d "$BODY" "$BASE/api/admin/login")"
  [ "$g" = "200" ] && ok "admin login" || bad "admin login -> $g"
  curl -sk -D- -o /dev/null -c "$JAR" -H 'Content-Type: application/json' -d "$BODY" "$BASE/api/admin/login" | tr -d '\r' | grep -i '^set-cookie: dwira_admin' | grep -qi 'httponly' && ok "cookie is HttpOnly" || bad "cookie is not HttpOnly"
  case "$BASE" in https://*) curl -sk -D- -o /dev/null -c "$JAR" -H 'Content-Type: application/json' -d "$BODY" "$BASE/api/admin/login" | tr -d '\r' | grep -i '^set-cookie: dwira_admin' | grep -qi 'secure' && ok "cookie is Secure" || bad "cookie is not Secure (COOKIE_SECURE=true?)";; esac
  [ "$(code -b "$JAR" "$BASE/api/admin/session")" = "200" ] && ok "session is valid" || bad "session not accepted"
  PNG=iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==
  URL="$(curl -sk -b "$JAR" -H 'Content-Type: application/json' -d "{\"data\":\"data:image/png;base64,$PNG\"}" "$BASE/api/admin/media" | sed -E 's/.*"url":"([^"]+)".*/\1/')"
  case "$URL" in /api/media/*|http*/api/media/*) ok "upload stored: $URL"
    header "media is cached for a year" "${URL#"$BASE"}" 'cache-control:.*max-age=31536000'
    status "media is served" 200 "${URL#"$BASE"}";;
    *) bad "upload failed: $URL";; esac
else
  echo "== Admin checks skipped (set ADMIN_EMAIL and ADMIN_PASSWORD to run them)"
fi

echo
echo "passed: $PASS   failed: $FAIL"
[ "$FAIL" = 0 ]
