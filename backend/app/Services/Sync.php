<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * Change counters for real-time sync (same keys as server/sync.js): content, requests, clients, chats, campaigns,
 * c:<clientId>, a:<adminId>, g:<deviceHash>. A bump is ONE statement per key (atomic upsert).
 */
final class Sync
{
    public function bump(string ...$keys): void
    {
        foreach (array_unique(array_filter($keys, fn ($k) => $k !== '')) as $key) {
            DB::statement('INSERT INTO sync_state(`key`, version) VALUES(?, 1) ON DUPLICATE KEY UPDATE version = version + 1', [$key]);
        }
    }

    /** @param list<string> $keys @return array<string,int> */
    public function read(array $keys): array
    {
        $keys = array_values(array_unique($keys));
        $marks = implode(',', array_fill(0, count($keys), '?'));
        $rows = DB::select("SELECT `key`, version FROM sync_state WHERE `key` IN ($marks)", $keys);
        $found = [];
        foreach ($rows as $row) {
            $found[$row->key] = (int) $row->version;
        }
        $out = [];
        foreach ($keys as $key) {
            $out[$key] = $found[$key] ?? 0;
        }

        return $out;
    }
}
