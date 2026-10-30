#!/usr/bin/env bash
# Builds the two folders you upload to Hostinger and zips them:
#
#   release/public_html/   Expo web export + .htaccess + _api.php            -> hPanel File Manager: public_html
#   release/laravel/       the Laravel API (vendor included, no dev tools)   -> next to public_html, NOT inside it
#   release/dwira-<date>.zip
#
# Run it on your own computer (needs PHP 8.3+, Composer, and Node 22 for the web export):
#   backend/deploy/build-release.sh                 # builds the web app too
#   SKIP_WEB=1 backend/deploy/build-release.sh      # reuse an existing ./dist
#   API_URL=https://api.example.com/api backend/deploy/build-release.sh   # only if the API lives on ANOTHER domain
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # repository root
BACKEND="$ROOT/backend"
HOST="$BACKEND/deploy/hostinger"
OUT="${OUT:-$ROOT/release}"
STAMP="$(date +%Y-%m-%d)"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

command -v php >/dev/null      || die "php not found"
command -v composer >/dev/null || die "composer not found"
command -v zip >/dev/null      || die "zip not found"
php -r 'exit(PHP_VERSION_ID >= 80300 ? 0 : 1);' || die "PHP 8.3+ required (found $(php -r 'echo PHP_VERSION;'))"
for ext in gd mbstring openssl pdo_mysql sodium curl fileinfo intl; do
  php -m | grep -qix "$ext" || echo "warning: PHP extension '$ext' is not loaded here (the build still works; check it is enabled on Hostinger)"
done

rm -rf "$OUT/public_html" "$OUT/laravel"
mkdir -p "$OUT/public_html" "$OUT/laravel"

# ---- 1. web app (static) -----------------------------------------------------------------------------------------------
if [ "${SKIP_WEB:-0}" != "1" ]; then
  say "Expo web export"
  command -v node >/dev/null || die "node not found (or run with SKIP_WEB=1 and a ready ./dist)"
  ( cd "$ROOT"
    [ -d node_modules ] || npm ci --no-audit --no-fund
    # Same origin: the app calls /api on its own domain, so no API URL is baked in.
    if [ -n "${API_URL:-}" ]; then EXPO_PUBLIC_API_URL="$API_URL" npm run build:web; else npm run build:web; fi )
fi
[ -f "$ROOT/dist/index.html" ] || die "dist/index.html is missing: build the web app first"
cp -a "$ROOT/dist/." "$OUT/public_html/"
# Hidden files never belong in the web root (only .well-known may stay): drop anything the export left behind.
find "$OUT/public_html" -mindepth 1 -name '.*' ! -path '*/.well-known' ! -path '*/.well-known/*' -prune -exec rm -rf {} +

cp "$HOST/public_html.htaccess" "$OUT/public_html/.htaccess"
cp "$HOST/user.ini" "$OUT/public_html/.user.ini"
cp "$HOST/_api.php" "$OUT/public_html/_api.php"
for d in _expo/static assets; do [ -d "$OUT/public_html/$d" ] && cp "$HOST/cache-immutable.htaccess" "$OUT/public_html/$d/.htaccess"; done
[ -d "$OUT/public_html/icons" ] && cp "$HOST/cache-icons.htaccess" "$OUT/public_html/icons/.htaccess"
[ -f "$OUT/public_html/push-sw.js" ] || cp "$ROOT/public/push-sw.js" "$OUT/public_html/push-sw.js"

# ---- 2. Laravel --------------------------------------------------------------------------------------------------------
say "Laravel (composer install --no-dev, optimized autoloader)"
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
# Copy sources only: no tests, no local .env, no logs, no uploaded media, no vendor from the dev machine.
( cd "$BACKEND" && tar -cf - \
    --exclude='./vendor' --exclude='./tests' --exclude='./deploy' --exclude='./.env' --exclude='./.env.*' --exclude='./node_modules' \
    --exclude='./storage/logs/*' --exclude='./storage/framework/cache/*' --exclude='./storage/framework/sessions/*' \
    --exclude='./storage/framework/views/*' --exclude='./storage/app/public/*' --exclude='./storage/app/private/*' \
    --exclude='./bootstrap/cache/*.php' --exclude='./.phpunit.cache' --exclude='./.phpunit.result.cache' --exclude='./database/*.sqlite' \
    --exclude='./public' . ) | ( cd "$STAGE" && tar -xf - )
cp "$BACKEND/.env.example" "$STAGE/.env.example"
( cd "$STAGE" && composer install --no-dev --prefer-dist --optimize-autoloader --classmap-authoritative --no-interaction --no-progress --no-scripts \
    --ignore-platform-req=ext-gd --ignore-platform-req=ext-intl --ignore-platform-req=ext-sodium >/dev/null )
# Laravel needs these folders to exist and be writable.
mkdir -p "$STAGE/bootstrap/cache" "$STAGE/storage/app/public/media" "$STAGE/storage/app/private" "$STAGE/storage/framework/"{cache/data,sessions,views} "$STAGE/storage/logs"
for d in bootstrap/cache storage/app/public/media storage/app/private storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs; do
  : > "$STAGE/$d/.gitkeep"
done
cp "$HOST/laravel.htaccess" "$STAGE/.htaccess"
cp -a "$STAGE/." "$OUT/laravel/"

# ---- 3. checks + zip ---------------------------------------------------------------------------------------------------
say "Checks"
[ -f "$OUT/laravel/vendor/autoload.php" ] || die "vendor/autoload.php missing"
[ ! -e "$OUT/laravel/.env" ] || die ".env must not be in the release"
[ ! -d "$OUT/laravel/vendor/phpunit" ] || die "dev dependencies leaked into the release"
[ ! -d "$OUT/laravel/tests" ] || die "tests leaked into the release"
php -l "$OUT/public_html/_api.php" >/dev/null
echo "public_html: $(find "$OUT/public_html" -type f | wc -l) files, $(du -sh "$OUT/public_html" | cut -f1)"
echo "laravel:     $(find "$OUT/laravel" -type f | wc -l) files, $(du -sh "$OUT/laravel" | cut -f1)"

say "Zip"
ZIP="$OUT/dwira-$STAMP.zip"
rm -f "$ZIP"
( cd "$OUT" && zip -qr "$ZIP" public_html laravel -x '*.DS_Store' )
echo "$ZIP ($(du -h "$ZIP" | cut -f1))"
echo
echo "Next: docs/HOSTINGER.md  (upload, .env, cron, first run)"
