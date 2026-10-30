<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * MySQL 8 / MariaDB 10.4+ equivalent of the Postgres schema in server/db.js (same table and column names, so the data
 * migration is a straight copy).
 *
 *  - utf8mb4 everywhere. Identifier-like columns (ids, tokens, keys) use utf8mb4_bin: Postgres compared them case-sensitively
 *    and MySQL's default collations would not (`abc` = `ABC`), which would merge distinct ids.
 *  - Document columns (`data`, `value`) stay TEXT, not JSON: the app relies on the exact key order of what it stored.
 *  - Epoch-millisecond timestamps stay BIGINT, exactly as the app writes them.
 *  - `seq` (content_items, space) is an insertion counter: Postgres returned unordered SELECTs in heap order, which in
 *    practice was insertion order; `ORDER BY seq` makes that explicit and stable.
 *  - Extra indexes the Postgres version lacked (user lookups of requests, expiry cleanups) - see comments.
 */
return new class extends Migration
{
    private const BIN = 'CHARACTER SET utf8mb4 COLLATE utf8mb4_bin';

    public function up(): void
    {
        $bin = self::BIN;
        $table = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC';

        $statements = [
            "CREATE TABLE clients (
                id VARCHAR(64) $bin NOT NULL,
                phone VARCHAR(32) $bin NOT NULL,
                name VARCHAR(255) NOT NULL,
                free_used TINYINT NOT NULL DEFAULT 0,
                credits INT NOT NULL DEFAULT 0,
                created_at BIGINT NOT NULL,
                blocked TINYINT NOT NULL DEFAULT 0,
                prefs VARCHAR(2000) NOT NULL DEFAULT '{}',
                last_seen BIGINT NULL,
                PRIMARY KEY (id),
                UNIQUE KEY clients_phone (phone),
                KEY clients_created (created_at)
            ) $table",

            "CREATE TABLE user_sessions (
                token_hash CHAR(64) $bin NOT NULL,
                client_id VARCHAR(64) $bin NOT NULL,
                expires_at BIGINT NOT NULL,
                PRIMARY KEY (token_hash),
                KEY user_sessions_client (client_id),
                KEY user_sessions_expires (expires_at),
                CONSTRAINT user_sessions_client_fk FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
            ) $table",

            "CREATE TABLE claims (
                id VARCHAR(100) $bin NOT NULL,
                client_id VARCHAR(64) $bin NOT NULL,
                free TINYINT NOT NULL,
                created_at BIGINT NULL,
                PRIMARY KEY (id),
                KEY claims_client (client_id, created_at),
                CONSTRAINT claims_client_fk FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
            ) $table",

            "CREATE TABLE space (
                seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                id VARCHAR(100) $bin NOT NULL,
                client_id VARCHAR(64) $bin NOT NULL,
                kind VARCHAR(32) $bin NOT NULL,
                value MEDIUMTEXT NOT NULL,
                PRIMARY KEY (id),
                UNIQUE KEY space_seq (seq),
                KEY space_client (client_id, kind, seq),
                CONSTRAINT space_client_fk FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
            ) $table",

            "CREATE TABLE admin_sessions (
                token_hash CHAR(64) $bin NOT NULL,
                expires_at BIGINT NOT NULL,
                admin_id VARCHAR(255) $bin NOT NULL DEFAULT 'admin',
                PRIMARY KEY (token_hash),
                KEY admin_sessions_expires (expires_at)
            ) $table",

            // requests.user_id is NOT a foreign key: a request outlives a deleted client (as in Postgres).
            "CREATE TABLE requests (
                id VARCHAR(100) $bin NOT NULL,
                user_id VARCHAR(64) $bin NOT NULL,
                client_request_id VARCHAR(100) $bin NULL,
                created_at BIGINT NOT NULL,
                data MEDIUMTEXT NOT NULL,
                PRIMARY KEY (id),
                UNIQUE KEY requests_user_request (user_id, client_request_id),
                KEY requests_created (created_at),
                KEY requests_user_created (user_id, created_at)
            ) $table",

            "CREATE TABLE subscriptions (
                id VARCHAR(255) $bin NOT NULL,
                data TEXT NOT NULL,
                owner_type VARCHAR(16) $bin NOT NULL DEFAULT 'admin',
                owner_id VARCHAR(255) $bin NOT NULL DEFAULT 'admin',
                device_id VARCHAR(255) $bin NULL,
                PRIMARY KEY (id),
                KEY subscriptions_owner (owner_type, owner_id),
                KEY subscriptions_device (device_id)
            ) $table",

            // request_id is the job key (request id, `lead:<client>`, `chat:<conv>:<msg>`, ...). Keys longer than 180
            // characters are stored as `h:<sha1>` by the application (see App\Services\Outbox).
            "CREATE TABLE outbox (
                request_id VARCHAR(191) $bin NOT NULL,
                attempts INT NOT NULL DEFAULT 0,
                next_at BIGINT NOT NULL,
                completed TEXT NOT NULL,
                kind VARCHAR(16) NOT NULL DEFAULT 'request',
                payload TEXT NULL,
                PRIMARY KEY (request_id),
                KEY outbox_due (next_at)
            ) $table",

            "CREATE TABLE settings (
                `key` VARCHAR(100) $bin NOT NULL,
                value MEDIUMTEXT NOT NULL,
                PRIMARY KEY (`key`)
            ) $table",

            "CREATE TABLE content_items (
                seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                coll VARCHAR(64) $bin NOT NULL,
                id VARCHAR(100) $bin NOT NULL,
                data MEDIUMTEXT NOT NULL,
                updated_at BIGINT NOT NULL,
                PRIMARY KEY (coll, id),
                UNIQUE KEY content_items_seq (seq)
            ) $table",

            "CREATE TABLE content_docs (
                name VARCHAR(64) $bin NOT NULL,
                data MEDIUMTEXT NOT NULL,
                updated_at BIGINT NOT NULL,
                PRIMARY KEY (name)
            ) $table",

            "CREATE TABLE admin_prefs (
                admin_id VARCHAR(255) $bin NOT NULL,
                data VARCHAR(2000) NOT NULL DEFAULT '{}',
                PRIMARY KEY (admin_id)
            ) $table",

            "CREATE TABLE sync_state (
                `key` VARCHAR(191) $bin NOT NULL,
                version BIGINT NOT NULL,
                PRIMARY KEY (`key`)
            ) $table",

            // Metadata only: the bytes live on disk (storage/app/public/media or MEDIA_PATH). `ext` is the extension of the
            // stored file, `orig_ext` the one of the first URL ever issued for it (old URLs keep working). Postgres had
            // `data` (legacy base64) and `body` (bytea): the import script writes those to disk instead.
            "CREATE TABLE media (
                id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
                mime VARCHAR(100) NOT NULL,
                ext VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
                orig_ext VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
                size BIGINT NOT NULL,
                width INT NULL,
                height INT NULL,
                storage VARCHAR(16) CHARACTER SET ascii NOT NULL DEFAULT 'disk',
                created_at BIGINT NOT NULL,
                PRIMARY KEY (id)
            ) $table",

            "CREATE TABLE guest_chats (
                id VARCHAR(100) $bin NOT NULL,
                device_hash CHAR(64) $bin NOT NULL,
                value MEDIUMTEXT NOT NULL,
                updated_at BIGINT NOT NULL,
                PRIMARY KEY (id),
                KEY guest_chats_device (device_hash, updated_at),
                KEY guest_chats_updated (updated_at)
            ) $table",

            "CREATE TABLE campaigns (
                id VARCHAR(64) $bin NOT NULL,
                kind VARCHAR(16) NOT NULL,
                data MEDIUMTEXT NOT NULL,
                status VARCHAR(16) NOT NULL,
                next_at BIGINT NULL,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL,
                PRIMARY KEY (id),
                KEY campaigns_status (status, next_at),
                KEY campaigns_updated (updated_at)
            ) $table",

            "CREATE TABLE campaign_deliveries (
                id VARCHAR(191) $bin NOT NULL,
                campaign_id VARCHAR(64) $bin NOT NULL,
                client_id VARCHAR(64) $bin NOT NULL,
                occurrence VARCHAR(100) $bin NOT NULL,
                status VARCHAR(16) NOT NULL,
                attempts INT NOT NULL DEFAULT 0,
                next_at BIGINT NOT NULL,
                created_at BIGINT NOT NULL,
                sent_at BIGINT NULL,
                devices INT NOT NULL DEFAULT 0,
                reason VARCHAR(64) NULL,
                completed TEXT NOT NULL,
                PRIMARY KEY (id),
                KEY campaign_deliveries_due (status, next_at),
                KEY campaign_deliveries_campaign (campaign_id, status),
                KEY campaign_deliveries_client (client_id, sent_at),
                CONSTRAINT campaign_deliveries_campaign_fk FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
                CONSTRAINT campaign_deliveries_client_fk FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
            ) $table",
        ];

        foreach ($statements as $sql) {
            DB::unprepared($sql);
        }
    }

    public function down(): void
    {
        DB::unprepared('SET FOREIGN_KEY_CHECKS=0');
        foreach (['campaign_deliveries', 'campaigns', 'guest_chats', 'media', 'sync_state', 'admin_prefs', 'content_docs', 'content_items', 'settings', 'outbox', 'subscriptions', 'requests', 'admin_sessions', 'space', 'claims', 'user_sessions', 'clients'] as $name) {
            DB::unprepared("DROP TABLE IF EXISTS $name");
        }
        DB::unprepared('SET FOREIGN_KEY_CHECKS=1');
    }
};
