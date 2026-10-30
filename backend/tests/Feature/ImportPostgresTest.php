<?php

namespace Tests\Feature;

use App\Services\Import\PgDumpReader;
use App\Services\Media;
use App\Services\Settings;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class ImportPostgresTest extends TestCase
{
    use DatabaseMigrations;

    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    private string $file;

    protected function setUp(): void
    {
        parent::setUp();
        $this->file = tempnam(sys_get_temp_dir(), 'dump').'.sql';
    }

    protected function tearDown(): void
    {
        @unlink($this->file);
        parent::tearDown();
    }

    private static function esc(?string $v): string
    {
        return $v === null ? '\\N' : str_replace(["\\", "\t", "\n", "\r"], ['\\\\', '\\t', '\\n', '\\r'], $v);
    }

    /** One COPY block exactly like pg_dump writes it. */
    private function copy(string $table, array $cols, array $rows): string
    {
        $out = "COPY public.$table (".implode(', ', $cols).") FROM stdin;\n";
        foreach ($rows as $r) {
            $out .= implode("\t", array_map(fn ($c) => self::esc($r[$c] ?? null), $cols))."\n";
        }

        return $out."\\.\n\n";
    }

    private function dump(string ...$blocks): void
    {
        file_put_contents($this->file, "--\n-- PostgreSQL database dump\n--\nSET statement_timeout = 0;\n\n".implode('', $blocks));
    }

    private function png(int $variant = 0): string
    {
        return base64_decode(self::PNG).str_repeat("\0", $variant); // trailing bytes keep it a valid PNG for the sniffer, new hash
    }

    private function mediaBlock(array $rows): string
    {
        return $this->copy('media', ['id', 'mime', 'data', 'created_at', 'body', 'size', 'storage'], $rows);
    }

    public function test_unescape_follows_copy_text_format(): void
    {
        $this->assertNull(PgDumpReader::unescape('\\N'));
        $this->assertSame("a\tb\nc\rd\\e", PgDumpReader::unescape('a\\tb\\nc\\rd\\\\e'));
        $this->assertSame('\\N', PgDumpReader::unescape('\\\\N')); // a real backslash + N is not NULL
        $this->assertSame("\x01\x41", PgDumpReader::unescape('\\001\\x41'));
        $this->assertSame('plain é 日本', PgDumpReader::unescape('plain é 日本'));
    }

    public function test_full_import_with_every_media_flavour_and_row_checks(): void
    {
        Http::fake(['https://cdn.example/media/*' => Http::response($this->png(3), 200)]);
        $bytea = $this->png(1);
        $legacy = $this->png(2);
        $r2 = $this->png(3);
        $id = fn (string $b) => Media::idOf($b);
        $inline = 'data:image/png;base64,'.self::PNG;
        $json = json_encode(['id' => 'x', 'title' => "tab\there \\ \"q\" é", 'image' => $inline], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $long = 'chat:'.str_repeat('z', 300);

        $this->dump(
            $this->copy('clients', ['id', 'phone', 'name', 'free_used', 'credits', 'created_at', 'blocked', 'prefs', 'last_seen'], [
                ['id' => 'c1', 'phone' => '+212661000001', 'name' => "Salma\tÉl", 'free_used' => '1', 'credits' => '3', 'created_at' => '1700000000000', 'blocked' => '0', 'prefs' => '{"lang":"fr"}', 'last_seen' => null],
            ]),
            $this->copy('user_sessions', ['token_hash', 'client_id', 'expires_at'], [['token_hash' => str_repeat('a', 64), 'client_id' => 'c1', 'expires_at' => '4102444800000']]),
            $this->copy('admin_sessions', ['token_hash', 'expires_at', 'admin_id'], [['token_hash' => str_repeat('b', 64), 'expires_at' => '4102444800000', 'admin_id' => 'admin']]),
            $this->copy('content_items', ['coll', 'id', 'data', 'updated_at'], [['coll' => 'tabs', 'id' => 'x', 'data' => $json, 'updated_at' => '1']]),
            $this->copy('outbox', ['request_id', 'attempts', 'next_at', 'completed', 'kind', 'payload'], [['request_id' => $long, 'attempts' => '0', 'next_at' => '5', 'completed' => '[]', 'kind' => 'chat', 'payload' => null]]),
            $this->copy('settings', ['key', 'value'], [
                ['key' => 'vapid', 'value' => '{"publicKey":"PUB","privateKey":"PRIV"}'],
                ['key' => 'schema_version', 'value' => 'abc'],
                ['key' => 'content_seeded', 'value' => '1700000000000'],
            ]),
            $this->mediaBlock([
                ['id' => $id($bytea), 'mime' => 'image/png', 'data' => '', 'created_at' => '1', 'body' => '\\x'.bin2hex($bytea), 'size' => (string) strlen($bytea), 'storage' => 'db'],
                ['id' => $id($legacy), 'mime' => 'image/png', 'data' => base64_encode($legacy), 'created_at' => '1', 'body' => null, 'size' => null, 'storage' => 'db'],
                ['id' => $id($r2), 'mime' => 'image/png', 'data' => '', 'created_at' => '1', 'body' => null, 'size' => '70', 'storage' => 'r2'],
                ['id' => str_repeat('c', 32), 'mime' => 'image/png', 'data' => '', 'created_at' => '1', 'body' => null, 'size' => '70', 'storage' => 'pending'],
            ]),
        );

        $this->artisan('dwira:import-pg', ['dump' => $this->file, '--r2-base' => 'https://cdn.example'])
            ->expectsOutputToContain('OK: every row is accounted for.')->assertExitCode(0);

        // counts and content
        $this->assertSame(1, DB::table('clients')->count());
        $this->assertSame("Salma\tÉl", DB::table('clients')->value('name'));
        $this->assertSame(0, DB::table('admin_sessions')->count(), 'admin sessions are not carried over');
        $this->assertSame(1, DB::table('user_sessions')->count());
        $this->assertNull(DB::table('settings')->where('key', 'schema_version')->value('value'));
        // pending upload skipped, three stored, plus the one created from the inline base64 image in the content row
        $this->assertSame(4, DB::table('media')->count());
        foreach ([$bytea, $legacy, $r2] as $b) {
            $row = DB::table('media')->where('id', $id($b))->first();
            $this->assertNotNull($row);
            $this->assertSame('png', $row->orig_ext, 'the old URL extension is kept');
            $this->assertFileExists(Media::dir()."/$row->id.$row->ext");
        }
        // inline base64 in content became a /api/media link; tabs, quotes and unicode survived the COPY escapes
        $item = json_decode(DB::table('content_items')->value('data'), true);
        $this->assertMatchesRegularExpression('#^/api/media/[a-f0-9]{32}\.[a-z0-9]+$#', $item['image']);
        $this->assertSame("tab\there \\ \"q\" é", $item['title']);
        // secrets are encrypted at rest and readable through Settings
        $this->assertStringStartsWith('enc:', DB::table('settings')->where('key', 'vapid')->value('value'));
        $this->assertSame('PRIV', ((array) app(Settings::class)->secret('vapid'))['privateKey']);
        // long outbox keys are hashed exactly like the application does
        $this->assertSame(['h:'.sha1($long)], DB::table('outbox')->pluck('request_id')->all());
        // the old URLs of the imported files answer
        $this->get('/api/media/'.$id($bytea).'.png')->assertOk();
        $this->get('/api/media/'.$id($legacy).'.png')->assertOk();
        // sync counters moved so open apps refetch
        $this->assertGreaterThan(0, (int) DB::table('sync_state')->where('key', 'content')->value('version'));
    }

    public function test_dry_run_changes_nothing_and_reports(): void
    {
        $this->dump($this->copy('clients', ['id', 'phone', 'name', 'free_used', 'credits', 'created_at', 'blocked', 'prefs', 'last_seen'], [
            ['id' => 'c1', 'phone' => '+1', 'name' => 'A', 'free_used' => '0', 'credits' => '0', 'created_at' => '1', 'blocked' => '0', 'prefs' => '{}', 'last_seen' => null],
        ]));
        $this->artisan('dwira:import-pg', ['dump' => $this->file, '--dry-run' => true])->expectsOutputToContain('DRY RUN')->assertExitCode(0);
        $this->assertSame(0, DB::table('clients')->count());
    }

    public function test_refuses_a_non_empty_target_unless_fresh(): void
    {
        $block = $this->copy('clients', ['id', 'phone', 'name', 'free_used', 'credits', 'created_at', 'blocked', 'prefs', 'last_seen'], [
            ['id' => 'c1', 'phone' => '+1', 'name' => 'A', 'free_used' => '0', 'credits' => '0', 'created_at' => '1', 'blocked' => '0', 'prefs' => '{}', 'last_seen' => null],
        ]);
        $this->dump($block);
        DB::table('clients')->insert(['id' => 'old', 'phone' => '+2', 'name' => 'Old', 'created_at' => 1]);
        $this->artisan('dwira:import-pg', ['dump' => $this->file])->expectsOutputToContain('not empty')->assertExitCode(1);
        $this->assertSame(['old'], DB::table('clients')->pluck('id')->all(), 'nothing was touched');
        $this->artisan('dwira:import-pg', ['dump' => $this->file, '--fresh' => true])->assertExitCode(0);
        $this->assertSame(['c1'], DB::table('clients')->pluck('id')->all());
    }

    public function test_orphans_duplicates_and_missing_r2_are_reported_not_hidden(): void
    {
        $this->dump(
            $this->copy('clients', ['id', 'phone', 'name', 'free_used', 'credits', 'created_at', 'blocked', 'prefs', 'last_seen'], [
                ['id' => 'c1', 'phone' => '+1', 'name' => 'A', 'free_used' => '0', 'credits' => '0', 'created_at' => '1', 'blocked' => '0', 'prefs' => '{}', 'last_seen' => null],
            ]),
            $this->copy('user_sessions', ['token_hash', 'client_id', 'expires_at'], [['token_hash' => str_repeat('a', 64), 'client_id' => 'ghost', 'expires_at' => '1']]),
        );
        $this->artisan('dwira:import-pg', ['dump' => $this->file])->expectsOutputToContain('orphan')->assertExitCode(1);

        $this->dump($this->copy('clients', ['id', 'phone', 'name', 'free_used', 'credits', 'created_at', 'blocked', 'prefs', 'last_seen'], [
            ['id' => 'c1', 'phone' => '+1', 'name' => 'A', 'free_used' => '0', 'credits' => '0', 'created_at' => '1', 'blocked' => '0', 'prefs' => '{}', 'last_seen' => null],
            ['id' => 'c2', 'phone' => '+1', 'name' => 'Same phone', 'free_used' => '0', 'credits' => '0', 'created_at' => '2', 'blocked' => '0', 'prefs' => '{}', 'last_seen' => null],
        ]));
        $this->artisan('dwira:import-pg', ['dump' => $this->file, '--fresh' => true])->expectsOutputToContain('failed')->assertExitCode(1);
        $this->assertSame(['c1'], DB::table('clients')->pluck('id')->all(), 'the good row still went in');

        $this->dump($this->mediaBlock([['id' => str_repeat('d', 32), 'mime' => 'image/png', 'data' => '', 'created_at' => '1', 'body' => null, 'size' => '70', 'storage' => 'r2']]));
        $this->artisan('dwira:import-pg', ['dump' => $this->file, '--fresh' => true])->expectsOutputToContain('stored in R2')->assertExitCode(0);
    }

    public function test_unusable_dumps_get_a_clear_message(): void
    {
        file_put_contents($this->file, "PGDMP\x01\x0e\x00");
        $this->artisan('dwira:import-pg', ['dump' => $this->file])->expectsOutputToContain('custom-format')->assertExitCode(1);
        file_put_contents($this->file, "INSERT INTO public.clients VALUES ('a');\n");
        $this->artisan('dwira:import-pg', ['dump' => $this->file])->expectsOutputToContain('--inserts')->assertExitCode(1);
        $this->artisan('dwira:import-pg', ['dump' => '/nonexistent.sql'])->expectsOutputToContain('not found')->assertExitCode(1);
    }
}
