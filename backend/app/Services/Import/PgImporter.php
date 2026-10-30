<?php

namespace App\Services\Import;

use App\Services\Media;
use App\Services\Media\Sniffer;
use App\Services\Outbox;
use App\Services\Sync;
use App\Support\Json;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use Throwable;

/**
 * Copies a plain `pg_dump` of the old Postgres database into the MySQL schema, moves every media file to disk and proves
 * the result: per-table row counts, primary-key set equality, orphan rows, media files present, dangling /api/media links.
 *
 *  - Columns are matched by name (the MySQL schema keeps the Postgres names). Media bytes (bytea `body`, legacy base64
 *    `data`, or R2 objects fetched over HTTP) go to disk through Media::storeMedia, with the SAME id and URL extension, so
 *    every stored `/api/media/<hash>.<ext>` link keeps working.
 *  - `vapid` and `chat_keys` settings are encrypted with APP_KEY (that is how Laravel stores secrets).
 *  - Admin sessions are NOT imported by default: the old default `admin/admin` login may have minted some. Admins sign in again.
 *  - Rows are never silently dropped: everything is imported, or counted under `skipped` / `failed` with a reason.
 */
final class PgImporter
{
    /** table => primary-key columns */
    public const TABLES = [
        'clients' => ['id'], 'user_sessions' => ['token_hash'], 'claims' => ['id'], 'space' => ['id'], 'admin_sessions' => ['token_hash'],
        'requests' => ['id'], 'subscriptions' => ['id'], 'outbox' => ['request_id'], 'settings' => ['key'],
        'content_items' => ['coll', 'id'], 'content_docs' => ['name'], 'admin_prefs' => ['admin_id'], 'sync_state' => ['key'],
        'media' => ['id'], 'guest_chats' => ['id'], 'campaigns' => ['id'], 'campaign_deliveries' => ['id'],
    ];

    /** Settings that hold secrets: stored encrypted by Laravel (value = JSON document, see App\Services\Settings). */
    private const SECRET_SETTINGS = ['vapid', 'chat_keys'];

    /** Settings that only describe the old schema bootstrap. */
    private const SKIP_SETTINGS = ['schema_version'];

    /** Columns that must hold JSON (warning only: the old API tolerated and repaired some of them). */
    private const JSON_COLUMNS = ['clients' => 'prefs', 'requests' => 'data', 'subscriptions' => 'data', 'content_items' => 'data', 'content_docs' => 'data',
        'admin_prefs' => 'data', 'guest_chats' => 'value', 'campaigns' => 'data', 'space' => 'value'];

    /** NOT NULL columns without a MySQL default: filled when an older dump does not have them. */
    private const FILL = ['outbox' => ['completed' => '[]'], 'campaign_deliveries' => ['completed' => '[]']];

    private const BATCH_BYTES = 1_000_000;

    private const BATCH_ROWS = 200;

    /** @var array<string, array<string,mixed>> */
    private array $report = [];

    /** @var array<string, list<string>> */
    private array $keys = [];

    /** @var array<string, true> media ids referenced from text columns */
    private array $referenced = [];

    /** @var array<string, true> media ids created while moving inline base64 images out of content rows */
    private array $extraMedia = [];

    private array $warnings = [];

    private array $errors = [];

    /** @var array<string, list<string>> */
    private array $columns = [];

    /** @param array{fresh?:bool,dry_run?:bool,only?:?array,r2_base?:?string,keep_admin_sessions?:bool,skip_media?:bool} $options */
    public function __construct(private readonly Media $media, private readonly Sync $sync, private readonly array $options = [])
    {
    }

    /** @return array{ok:bool,tables:array,warnings:list<string>,errors:list<string>,dry_run:bool} */
    public function run(string $dumpPath, ?callable $progress = null): array
    {
        $only = $this->options['only'] ?? null;
        $dry = (bool) ($this->options['dry_run'] ?? false);
        $fresh = (bool) ($this->options['fresh'] ?? false);
        $reader = new PgDumpReader($dumpPath);
        $wanted = $only ?: array_keys(self::TABLES);
        foreach ($wanted as $t) {
            if (! isset(self::TABLES[$t])) {
                throw new RuntimeException("Unknown table '$t'. Known: ".implode(', ', array_keys(self::TABLES)));
            }
        }
        foreach ($wanted as $t) {
            $this->report[$t] = ['dump' => 0, 'imported' => 0, 'skipped' => [], 'failed' => 0, 'mysql' => null, 'keys' => null];
            $this->keys[$t] = [];
        }
        foreach ($wanted as $t) {
            $this->columns[$t] = Schema::getColumnListing($t);
        }
        if (! $dry) {
            $this->prepare($wanted, $fresh, $only !== null);
            DB::statement('SET FOREIGN_KEY_CHECKS=0');
        }
        try {
            $batches = [];
            $sizes = [];
            foreach ($reader->rows($wanted) as [$table, $row]) {
                $this->report[$table]['dump']++;
                if ($progress && $this->report[$table]['dump'] % 500 === 0) {
                    $progress($table, $this->report[$table]['dump']);
                }
                try {
                    $out = $table === 'media' ? $this->media($row, $dry) : $this->convert($table, $row);
                } catch (Throwable $e) {
                    $this->fail($table, $e->getMessage(), $row);

                    continue;
                }
                if (is_string($out)) { // skipped, with its reason
                    $this->report[$table]['skipped'][$out] = ($this->report[$table]['skipped'][$out] ?? 0) + 1;

                    continue;
                }
                $this->track($table, $out);
                if ($table === 'media' || $dry) {
                    $this->report[$table]['imported']++;

                    continue;
                }
                $batches[$table][] = $out;
                $sizes[$table] = ($sizes[$table] ?? 0) + array_sum(array_map('strlen', array_map('strval', $out)));
                if (count($batches[$table]) >= self::BATCH_ROWS || $sizes[$table] >= self::BATCH_BYTES) {
                    $this->flush($table, $batches[$table]);
                    $batches[$table] = [];
                    $sizes[$table] = 0;
                }
            }
            foreach ($batches as $table => $rows) {
                $this->flush($table, $rows);
            }
        } finally {
            if (! $dry) {
                DB::statement('SET FOREIGN_KEY_CHECKS=1');
            }
        }
        if (! $dry) {
            $this->verify($wanted, $only !== null);
            $this->sync->bump('content', 'requests', 'clients', 'chats', 'campaigns');
            Cache::flush();
        }
        foreach ($wanted as $t) {
            $r = $this->report[$t];
            $accounted = $r['imported'] + array_sum($r['skipped']) + $r['failed'];
            if ($accounted !== $r['dump']) {
                $this->errors[] = "$t: {$r['dump']} rows in the dump but only $accounted accounted for";
            }
            if ($r['failed'] > 0) {
                $this->errors[] = "$t: {$r['failed']} row(s) failed (see the messages above)";
            }
        }

        return ['ok' => $this->errors === [], 'tables' => $this->report, 'warnings' => $this->warnings, 'errors' => $this->errors, 'dry_run' => $dry];
    }

    /** @param list<string> $wanted */
    private function prepare(array $wanted, bool $fresh, bool $partial): void
    {
        $dirty = array_filter($wanted, fn ($t) => $t !== 'media' && DB::table($t)->exists());
        if ($partial) {
            $dirty = [];
        }
        if ($dirty && ! $fresh) {
            throw new RuntimeException('The target database is not empty ('.implode(', ', $dirty).'). Import before the site gets any traffic (the first request seeds default content), or pass --fresh to wipe the Dwira tables first.');
        }
        if ($fresh) {
            DB::statement('SET FOREIGN_KEY_CHECKS=0');
            foreach (array_reverse($wanted) as $t) {
                DB::statement("TRUNCATE TABLE `$t`");
            }
            DB::statement('SET FOREIGN_KEY_CHECKS=1');
        }
    }

    /** @return array<string,mixed>|string row to insert, or the reason it is skipped */
    private function convert(string $table, array $row): array|string
    {
        if ($table === 'admin_sessions' && ! ($this->options['keep_admin_sessions'] ?? false)) {
            return 'not imported on purpose: admins sign in again';
        }
        if ($table === 'settings') {
            if (in_array($row['key'], self::SKIP_SETTINGS, true)) {
                return 'old schema marker';
            }
            if (in_array($row['key'], self::SECRET_SETTINGS, true)) {
                $row['value'] = 'enc:'.Crypt::encryptString((string) $row['value']);
            }
        }
        if ($table === 'outbox') {
            $row['request_id'] = Outbox::key((string) $row['request_id']);
        }
        if (in_array($table, ['content_items', 'content_docs'], true) && isset($row['data']) && str_contains($row['data'], 'data:') && str_contains($row['data'], ';base64,')) {
            $row['data'] = $this->externalize($row['data']);
        }
        foreach (self::FILL[$table] ?? [] as $col => $value) {
            $row[$col] ??= $value;
        }
        if (isset(self::JSON_COLUMNS[$table])) {
            $col = self::JSON_COLUMNS[$table];
            if (($row[$col] ?? null) !== null && ! json_validate((string) $row[$col])) {
                $this->warn("$table: a row has invalid JSON in `$col` (copied as is): ".$this->label($table, $row));
            }
        }
        foreach (['data', 'value', 'prefs'] as $col) {
            if (isset($row[$col]) && is_string($row[$col]) && str_contains($row[$col], '/api/media/')) {
                preg_match_all('#/api/media/([a-f0-9]{32})\.[a-z0-9]+#', $row[$col], $m);
                foreach ($m[1] as $id) {
                    $this->referenced[$id] = true;
                }
            }
        }
        $unknown = array_diff(array_keys($row), $this->columns[$table] ?? array_keys($row));
        if ($unknown) {
            $this->warn("$table: column(s) ".implode(', ', $unknown).' do not exist in MySQL and were ignored');
        }

        return array_intersect_key($row, array_flip($this->columns[$table]));
    }

    /** Old content rows could still hold inline base64 images (the Node server moved them on start). */
    private function externalize(string $json): string
    {
        if ($this->options['dry_run'] ?? false) {
            return $json;
        }
        $result = $this->media->externalize(Json::decode($json), 'skip');
        if (! $result['changed']) {
            return $json;
        }
        $new = Json::encode($result['value']);
        preg_match_all('#/api/media/([a-f0-9]{32})\.[a-z0-9]+#', $new, $m);
        foreach ($m[1] as $id) {
            $this->extraMedia[$id] = true; // a new `media` row the dump did not have: expected by the checks
        }

        return $new;
    }

    /** One `media` row: bytes -> disk. Returns the metadata row (counted/tracked) or a skip reason. */
    private function media(array $row, bool $dry): array|string
    {
        $id = (string) ($row['id'] ?? '');
        if (! preg_match('/^[a-f0-9]{32}$/', $id)) {
            throw new RuntimeException("media id '$id' is not a 32-character hash");
        }
        $storage = (string) ($row['storage'] ?? 'db');
        if ($storage === 'pending') {
            return 'unfinished direct upload (never completed)';
        }
        if ($this->options['skip_media'] ?? false) {
            return 'media skipped by --skip-media';
        }
        $mime = (string) ($row['mime'] ?? '');
        if (! isset(Sniffer::EXT[$mime])) {
            throw new RuntimeException("media $id has unsupported type '$mime'");
        }
        $bytes = $this->bytesOf($row, $id, $mime, $storage);
        if ($bytes === null) {
            return 'stored in R2 and no --r2-base given';
        }
        $actual = Sniffer::sniff($bytes);
        if ($actual === '' || ! isset(Sniffer::EXT[$actual])) {
            throw new RuntimeException("media $id: the bytes are not a supported image or video");
        }
        if (! $dry) {
            $this->media->storeMedia($bytes, $actual, $id, $mime);
        }

        return ['id' => $id];
    }

    private function bytesOf(array $row, string $id, string $mime, string $storage): ?string
    {
        if ($storage === 'r2') {
            $base = rtrim((string) ($this->options['r2_base'] ?? ''), '/');
            if ($base === '') {
                return null;
            }
            if ($this->options['dry_run'] ?? false) {
                return "\x89PNG\r\n\x1a\n"; // not downloaded in a dry run
            }
            $url = "$base/media/$id.".Sniffer::EXT[$mime];
            $res = Http::timeout(120)->get($url);
            if (! $res->successful()) {
                throw new RuntimeException("media $id: R2 download failed (HTTP {$res->status()}) $url");
            }

            return $res->body();
        }
        $body = $row['body'] ?? null;
        if ($body !== null && $body !== '') {
            if (! str_starts_with($body, '\\x')) {
                throw new RuntimeException("media $id: bytea is not in hex format (dump with bytea_output=hex, the default)");
            }
            $bin = hex2bin(substr($body, 2));
            if ($bin === false) {
                throw new RuntimeException("media $id: invalid bytea hex");
            }

            return $bin;
        }
        $legacy = (string) ($row['data'] ?? '');
        if ($legacy !== '') { // legacy: base64 text in `data`
            $bin = base64_decode($legacy, true);
            if ($bin === false) {
                throw new RuntimeException("media $id: invalid legacy base64");
            }

            return $bin;
        }
        throw new RuntimeException("media $id: row has no bytes (body and data are empty)");
    }

    /** Keys the MySQL table must hold: those of the dump, plus media created from inline base64 images. */
    private function expectedKeys(string $table): array
    {
        $keys = $this->keys[$table];
        if ($table === 'media') {
            $keys = array_values(array_unique([...$keys, ...array_keys($this->extraMedia)]));
        }

        return $keys;
    }

    private function track(string $table, array $row): void
    {
        $this->keys[$table][] = implode("\x1f", array_map(fn ($c) => (string) ($row[$c] ?? ''), self::TABLES[$table]));
    }

    /** @param list<array<string,mixed>> $rows */
    private function flush(string $table, array $rows): void
    {
        if ($rows === []) {
            return;
        }
        try {
            DB::table($table)->insert($rows);
            $this->report[$table]['imported'] += count($rows);
        } catch (Throwable) {
            foreach ($rows as $row) { // find the offending row(s); the others still go in
                try {
                    DB::table($table)->insert($row);
                    $this->report[$table]['imported']++;
                } catch (Throwable $e) {
                    $key = implode("\x1f", array_map(fn ($c) => (string) ($row[$c] ?? ''), self::TABLES[$table]));
                    $this->keys[$table] = array_values(array_diff($this->keys[$table], [$key]));
                    $this->fail($table, $this->short($e), $row);
                }
            }
        }
    }

    /** @param list<string> $wanted */
    private function verify(array $wanted, bool $partial): void
    {
        foreach ($wanted as $t) {
            $count = (int) DB::table($t)->count();
            $this->report[$t]['mysql'] = $count;
            if ($t === 'media') {
                $missing = 0;
                foreach (DB::table('media')->get(['id', 'ext']) as $m) {
                    if (! is_file(Media::dir()."/$m->id.$m->ext")) {
                        $missing++;
                    }
                }
                if ($missing) {
                    $this->errors[] = "media: $missing file(s) missing on disk in ".Media::dir();
                }
            }
            $imported = count($this->expectedKeys($t)) === count($this->keys[$t]) || $t !== 'media' ? $this->report[$t]['imported'] : count($this->expectedKeys($t)) - count($this->keys[$t]) + $this->report[$t]['imported'];
            if (! $partial) {
                if ($count !== $imported) {
                    $this->errors[] = "$t: row count mismatch, imported $imported but MySQL has $count";
                }
                $this->report[$t]['keys'] = $this->sameKeys($t);
                if ($this->report[$t]['keys'] === false) {
                    $this->errors[] = "$t: the set of primary keys in MySQL differs from the dump";
                }
            } elseif ($count < $imported) {
                $this->errors[] = "$t: MySQL has $count rows, fewer than the $imported imported";
            }
        }
        $orphans = [
            'user_sessions.client_id' => 'SELECT COUNT(*) c FROM user_sessions x LEFT JOIN clients p ON p.id = x.client_id WHERE p.id IS NULL',
            'claims.client_id' => 'SELECT COUNT(*) c FROM claims x LEFT JOIN clients p ON p.id = x.client_id WHERE p.id IS NULL',
            'space.client_id' => 'SELECT COUNT(*) c FROM space x LEFT JOIN clients p ON p.id = x.client_id WHERE p.id IS NULL',
            'campaign_deliveries.campaign_id' => 'SELECT COUNT(*) c FROM campaign_deliveries x LEFT JOIN campaigns p ON p.id = x.campaign_id WHERE p.id IS NULL',
            'campaign_deliveries.client_id' => 'SELECT COUNT(*) c FROM campaign_deliveries x LEFT JOIN clients p ON p.id = x.client_id WHERE p.id IS NULL',
        ];
        if (! $partial) {
            foreach ($orphans as $what => $sql) {
                $n = (int) DB::selectOne($sql)->c;
                if ($n) {
                    $this->errors[] = "$n orphan row(s): $what points to a missing parent";
                }
            }
        }
        if (in_array('media', $wanted, true) && $this->referenced) {
            $have = array_flip(DB::table('media')->pluck('id')->all());
            $dangling = array_diff_key($this->referenced, $have);
            if ($dangling) {
                $this->warn(count($dangling).' /api/media link(s) in your data point to files that were not imported (e.g. '.implode(', ', array_slice(array_keys($dangling), 0, 3)).'). R2 files need --r2-base=<R2_PUBLIC_BASE_URL>.');
            }
        }
    }

    private function sameKeys(string $table): bool
    {
        $cols = self::TABLES[$table];
        $db = [];
        foreach (DB::table($table)->select($cols)->cursor() as $r) {
            $db[] = implode("\x1f", array_map(fn ($c) => (string) $r->{$c}, $cols));
        }
        $mine = $this->expectedKeys($table);
        sort($db, SORT_STRING);
        sort($mine, SORT_STRING);

        return md5(implode("\n", $db)) === md5(implode("\n", $mine));
    }

    private function fail(string $table, string $message, array $row): void
    {
        $this->report[$table]['failed']++;
        $this->errors[] = "$table ".$this->label($table, $row).': '.$message;
    }

    private function label(string $table, array $row): string
    {
        return '['.implode(',', array_map(fn ($c) => substr((string) ($row[$c] ?? '?'), 0, 40), self::TABLES[$table])).']';
    }

    private function warn(string $message): void
    {
        if (count($this->warnings) < 50) {
            $this->warnings[] = $message;
        }
    }

    private function short(Throwable $e): string
    {
        return mb_substr(preg_replace('/\s+/', ' ', $e->getMessage()), 0, 220);
    }
}
