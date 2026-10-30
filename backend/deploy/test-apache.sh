#!/usr/bin/env bash
# Runs the release through a real Apache (mod_rewrite + mod_headers + mod_php) and then the smoke test against it.
# Needs: apache2 + libapache2-mod-php (Debian/Ubuntu: apt install apache2 libapache2-mod-php), MySQL/MariaDB with an empty
# database. Hostinger runs LiteSpeed, which reads the same .htaccess rules, but only a test on the real host proves that.
#
#   DB_DATABASE=dwira_apache DB_USERNAME=dwira DB_PASSWORD=secret backend/deploy/test-apache.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="${OUT:-$(mktemp -d)}"
PORT="${PORT:-8088}"
APACHE="$(command -v apache2 || command -v /usr/sbin/apache2)"; MODS="${APACHE_MODULES:-/usr/lib/apache2/modules}"
: "${DB_DATABASE:?}" "${DB_USERNAME:?}" "${DB_PASSWORD:?}"
PHPMOD="$(cd "$MODS" && ls libphp*.so | head -1)"

SKIP_WEB="${SKIP_WEB:-1}" OUT="$OUT" "$HERE/build-release.sh" >/dev/null
cd "$OUT/laravel"
KEY="base64:$(php -r 'echo base64_encode(random_bytes(32));')"
PASS_PLAIN="correct-horse-battery"
HASH="$(php -r 'echo password_hash("correct-horse-battery", PASSWORD_BCRYPT);')"
cat > .env <<ENV
APP_ENV=production
APP_DEBUG=false
APP_KEY=$KEY
APP_URL=http://localhost:$PORT
DB_CONNECTION=mysql
DB_HOST=${DB_HOST:-127.0.0.1}
DB_DATABASE=$DB_DATABASE
DB_USERNAME=$DB_USERNAME
DB_PASSWORD=$DB_PASSWORD
CACHE_STORE=file
SESSION_DRIVER=array
QUEUE_CONNECTION=sync
ADMIN_EMAIL=owner@example.com
ADMIN_PASSWORD_HASH='$HASH'
COOKIE_SECURE=false
ENV
php artisan migrate --force >/dev/null
php artisan config:cache >/dev/null; php artisan route:cache >/dev/null; php artisan view:cache >/dev/null

W="$OUT/apache"; mkdir -p "$W/run" "$W/logs"
cat > "$W/httpd.conf" <<CONF
ServerRoot ${MODS%/modules}
ServerName localhost
Listen $PORT
PidFile $W/run/pid
ErrorLog $W/logs/error.log
LoadModule mpm_prefork_module $MODS/mod_mpm_prefork.so
LoadModule authz_core_module $MODS/mod_authz_core.so
LoadModule mime_module $MODS/mod_mime.so
LoadModule dir_module $MODS/mod_dir.so
LoadModule alias_module $MODS/mod_alias.so
LoadModule rewrite_module $MODS/mod_rewrite.so
LoadModule headers_module $MODS/mod_headers.so
LoadModule setenvif_module $MODS/mod_setenvif.so
LoadModule deflate_module $MODS/mod_deflate.so
LoadModule env_module $MODS/mod_env.so
LoadModule php_module $MODS/$PHPMOD
TypesConfig /etc/mime.types
DocumentRoot $OUT/public_html
<Directory />
  AllowOverride None
  Require all denied
</Directory>
<Directory $OUT/public_html>
  AllowOverride All
  Require all granted
</Directory>
<FilesMatch "\.php\$">
  SetHandler application/x-httpd-php
</FilesMatch>
php_value post_max_size 128M
php_value upload_max_filesize 128M
CONF
"$APACHE" -f "$W/httpd.conf" -k start
trap '"$APACHE" -f "$W/httpd.conf" -k stop >/dev/null 2>&1 || true' EXIT
sleep 2
ADMIN_EMAIL=owner@example.com ADMIN_PASSWORD="$PASS_PLAIN" "$HERE/smoke-test.sh" "http://localhost:$PORT"
