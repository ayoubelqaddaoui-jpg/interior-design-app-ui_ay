<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;

use function Laravel\Prompts\password;

class AdminPassword extends Command
{
    protected $signature = 'dwira:admin-password {--password= : Non-interactive (visible in shell history, prefer the prompt)}';

    protected $description = 'Hash an admin password for ADMIN_PASSWORD_HASH (argon2id, or bcrypt where argon2 is missing)';

    public function handle(): int
    {
        $plain = (string) ($this->option('password') ?: password('Admin password (min 12 characters)', required: true));
        if (mb_strlen($plain) < 12) {
            $this->components->error('Use at least 12 characters.');

            return self::FAILURE;
        }
        if (strlen($plain) > 512) {
            $this->components->error('Max 512 bytes.');

            return self::FAILURE;
        }
        $hash = defined('PASSWORD_ARGON2ID') ? password_hash($plain, PASSWORD_ARGON2ID) : password_hash($plain, PASSWORD_BCRYPT, ['cost' => 12]);
        $this->line('Put these in .env (keep the single quotes, the hash contains $):');
        $this->line("ADMIN_PASSWORD_HASH='$hash'");

        return self::SUCCESS;
    }
}
