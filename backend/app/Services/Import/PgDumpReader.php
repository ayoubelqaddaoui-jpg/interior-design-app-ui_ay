<?php

namespace App\Services\Import;

use RuntimeException;

/**
 * Streams the data of a plain-format `pg_dump` (the default; also .gz). Only `COPY <table> (<cols>) FROM stdin;` blocks are
 * read, one row at a time, so a dump with big media rows never has to fit in memory twice.
 *
 * COPY text format: tab-separated, `\N` = NULL, backslash escapes (\\ \t \n \r \b \f \v \ooo \xHH). A bytea column therefore
 * arrives as `\x<hex>` once unescaped.
 */
final class PgDumpReader
{
    private const ESCAPES = ['b' => "\x08", 'f' => "\x0c", 'n' => "\n", 'r' => "\r", 't' => "\t", 'v' => "\x0b"];

    /** @var resource */
    private $handle;

    public function __construct(private readonly string $path)
    {
        if (! is_file($this->path) || ! is_readable($this->path)) {
            throw new RuntimeException("Dump not found or not readable: {$this->path}");
        }
        $magic = (string) file_get_contents($this->path, false, null, 0, 5);
        if ($magic === 'PGDMP') {
            throw new RuntimeException('This is a pg_dump custom-format (-Fc) file. Convert it first: pg_restore -f dump.sql <file>  (or dump with: pg_dump --no-owner --no-acl -Fp)');
        }
        $handle = str_ends_with($this->path, '.gz') ? @fopen('compress.zlib://'.$this->path, 'rb') : @fopen($this->path, 'rb');
        if (! $handle) {
            throw new RuntimeException("Cannot open {$this->path}");
        }
        $this->handle = $handle;
    }

    public function __destruct()
    {
        if (is_resource($this->handle)) {
            fclose($this->handle);
        }
    }

    /**
     * @param  list<string>|null  $only  tables to parse; the others are skipped without being decoded
     * @return \Generator<int, array{0:string,1:array<string,?string>}> [table, row] in file order
     */
    public function rows(?array $only = null): \Generator
    {
        $table = null;
        $skip = false;
        $columns = [];
        $copyBlocks = 0;
        $insertLines = 0;
        while (($line = fgets($this->handle)) !== false) {
            $line = rtrim($line, "\r\n");
            if ($table === null) {
                if (str_starts_with($line, 'COPY ') && preg_match('/^COPY (?:"?[A-Za-z0-9_]+"?\.)?"?([A-Za-z0-9_]+)"? \((.*)\) FROM stdin;$/', $line, $m)) {
                    $table = $m[1];
                    $skip = $only !== null && ! in_array($table, $only, true);
                    $columns = array_map(fn ($c) => trim($c, '" '), explode(',', $m[2]));
                    $copyBlocks++;
                } elseif (str_starts_with($line, 'INSERT INTO ')) {
                    $insertLines++;
                }

                continue;
            }
            if ($line === '\\.') {
                $table = null;

                continue;
            }
            if ($skip) {
                continue;
            }
            $fields = explode("\t", $line);
            if (count($fields) !== count($columns)) {
                throw new RuntimeException("Malformed COPY row in table $table: ".count($fields).' fields, expected '.count($columns));
            }
            $row = [];
            foreach ($columns as $i => $name) {
                $row[$name] = self::unescape($fields[$i]);
            }
            yield [$table, $row];
        }
        if ($copyBlocks === 0 && $insertLines > 0) {
            throw new RuntimeException('This dump uses INSERT statements (pg_dump --inserts). Dump again without --inserts (plain COPY format) so it can be imported.');
        }
        if ($copyBlocks === 0) {
            throw new RuntimeException('No table data found in the dump. Use a data-including plain dump: pg_dump --no-owner --no-acl -Fp "$DATABASE_URL" > dump.sql');
        }
    }

    public static function unescape(string $field): ?string
    {
        if ($field === '\\N') {
            return null;
        }
        if (! str_contains($field, '\\')) {
            return $field;
        }

        return preg_replace_callback('/\\\\(x[0-9A-Fa-f]{1,2}|[0-7]{1,3}|.)/s', function (array $m): string {
            $c = $m[1];
            if (isset(self::ESCAPES[$c])) {
                return self::ESCAPES[$c];
            }
            if ($c[0] === 'x' && strlen($c) > 1) {
                return chr(hexdec(substr($c, 1)));
            }
            if (ctype_digit($c[0]) && $c[0] <= '7') {
                return chr(octdec($c) & 0xFF);
            }

            return $c; // \\ -> \ and any other escaped character -> itself
        }, $field);
    }
}
