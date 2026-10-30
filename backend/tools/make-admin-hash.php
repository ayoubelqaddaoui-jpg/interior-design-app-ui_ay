<?php
// Standalone: `php tools/make-admin-hash.php 'my long password'` prints the ADMIN_PASSWORD_HASH line (no Laravel needed).
$plain = $argv[1] ?? '';
if (mb_strlen($plain) < 12) {
    fwrite(STDERR, "Usage: php tools/make-admin-hash.php 'password of at least 12 characters'\n");
    exit(1);
}
$hash = defined('PASSWORD_ARGON2ID') ? password_hash($plain, PASSWORD_ARGON2ID) : password_hash($plain, PASSWORD_BCRYPT, ['cost' => 12]);
echo "ADMIN_PASSWORD_HASH='$hash'\n";
