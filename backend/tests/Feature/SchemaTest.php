<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class SchemaTest extends TestCase
{
    use DatabaseMigrations;

    private const TABLES = ['clients', 'user_sessions', 'claims', 'space', 'admin_sessions', 'requests', 'subscriptions', 'outbox', 'settings',
        'content_items', 'content_docs', 'admin_prefs', 'sync_state', 'media', 'guest_chats', 'campaigns', 'campaign_deliveries'];

    public function test_every_postgres_table_exists_and_is_utf8mb4(): void
    {
        foreach (self::TABLES as $table) {
            $row = DB::selectOne('SELECT TABLE_COLLATION c, ENGINE e FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [$table]);
            $this->assertNotNull($row, "missing table $table");
            $this->assertStringStartsWith('utf8mb4', $row->c, $table);
            $this->assertSame('InnoDB', $row->e, $table);
        }
    }

    public function test_ids_are_case_sensitive(): void
    {
        DB::table('clients')->insert(['id' => 'abc', 'phone' => '+212600000001', 'name' => 'A', 'created_at' => 1]);
        DB::table('clients')->insert(['id' => 'ABC', 'phone' => '+212600000002', 'name' => 'B', 'created_at' => 2]);
        $this->assertSame(2, DB::table('clients')->count());
        $this->assertSame('A', DB::table('clients')->where('id', 'abc')->value('name'));
    }

    public function test_emoji_and_arabic_round_trip(): void
    {
        $text = '{"t":"مرحبا 🏠 Déco"}';
        DB::table('content_docs')->insert(['name' => 'x', 'data' => $text, 'updated_at' => 1]);
        $this->assertSame($text, DB::table('content_docs')->where('name', 'x')->value('data'));
    }

    public function test_foreign_keys_cascade_and_requests_survive_a_deleted_client(): void
    {
        DB::table('clients')->insert(['id' => 'c1', 'phone' => '+212600000001', 'name' => 'A', 'created_at' => 1]);
        DB::table('user_sessions')->insert(['token_hash' => str_repeat('a', 64), 'client_id' => 'c1', 'expires_at' => 9]);
        DB::table('claims')->insert(['id' => 'claim-001', 'client_id' => 'c1', 'free' => 1, 'created_at' => 1]);
        DB::table('space')->insert(['id' => 's1', 'client_id' => 'c1', 'kind' => 'history', 'value' => '{}']);
        DB::table('requests')->insert(['id' => 'r1', 'user_id' => 'c1', 'client_request_id' => 'req-0001', 'created_at' => 1, 'data' => '{}']);
        DB::table('clients')->where('id', 'c1')->delete();
        foreach (['user_sessions', 'claims', 'space'] as $table) {
            $this->assertSame(0, DB::table($table)->count(), $table);
        }
        $this->assertSame(1, DB::table('requests')->count());
    }

    public function test_request_idempotency_key_is_unique_per_user(): void
    {
        DB::table('requests')->insert(['id' => 'r1', 'user_id' => 'c1', 'client_request_id' => 'req-0001', 'created_at' => 1, 'data' => '{}']);
        $this->expectException(\Illuminate\Database\UniqueConstraintViolationException::class);
        DB::table('requests')->insert(['id' => 'r2', 'user_id' => 'c1', 'client_request_id' => 'req-0001', 'created_at' => 2, 'data' => '{}']);
    }

    public function test_content_items_keep_insertion_order_through_seq(): void
    {
        foreach (['b', 'a', 'c'] as $i => $id) {
            DB::table('content_items')->insert(['coll' => 'tabs', 'id' => $id, 'data' => '{}', 'updated_at' => $i]);
        }
        $this->assertSame(['b', 'a', 'c'], DB::table('content_items')->orderBy('seq')->pluck('id')->all());
    }

    public function test_hot_queries_use_an_index(): void
    {
        // The optimiser ignores indexes on empty tables: give each one a few rows first.
        DB::table('admin_sessions')->insert([['token_hash' => 'a', 'expires_at' => 1], ['token_hash' => 'b', 'expires_at' => 2]]);
        DB::table('outbox')->insert([['request_id' => 'a', 'next_at' => 1, 'completed' => '[]'], ['request_id' => 'b', 'next_at' => 2, 'completed' => '[]']]);
        $plans = [
            'SELECT 1 FROM admin_sessions WHERE token_hash = ? AND expires_at > ?' => ['a', 0],
            'SELECT * FROM requests WHERE user_id = ? ORDER BY created_at DESC' => ['x'],
            'SELECT * FROM outbox WHERE next_at <= ? ORDER BY next_at LIMIT 20' => [1],
            "SELECT * FROM campaign_deliveries WHERE status = 'pending' AND next_at <= ? ORDER BY next_at LIMIT 200" => [1],
            'SELECT value FROM guest_chats WHERE device_hash = ? ORDER BY updated_at DESC' => ['x'],
            'SELECT value FROM space WHERE client_id = ? AND kind = ? ORDER BY seq' => ['x', 'history'],
        ];
        foreach ($plans as $sql => $bindings) {
            $explain = DB::select('EXPLAIN '.$sql, $bindings)[0];
            $this->assertNotNull($explain->possible_keys ?? null, "no usable index for: $sql");
        }
    }
}
