<?php

namespace App\Services;

use Closure;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/** Small helpers for the Postgres idioms the Node code used (ON CONFLICT DO NOTHING RETURNING, FOR UPDATE transactions). */
final class Db
{
    /** `INSERT ... ON CONFLICT DO NOTHING` -> true when the row was inserted, false when the key already existed. */
    public static function insertIfAbsent(string $table, array $row): bool
    {
        try {
            DB::table($table)->insert($row);

            return true;
        } catch (UniqueConstraintViolationException) {
            return false;
        }
    }

    /** Transaction that retries on deadlock (InnoDB may pick either of two concurrent writers as the victim). */
    public static function tx(Closure $work): mixed
    {
        return DB::transaction($work, 3);
    }

    /** Decoded-JSON column helper: `data` text -> stdClass/array (null when invalid). */
    public static function decode(?string $text): mixed
    {
        return \App\Support\Json::tryDecode($text);
    }
}
