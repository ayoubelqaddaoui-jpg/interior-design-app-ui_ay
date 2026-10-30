<?php

namespace App\Console\Commands;

use App\Services\Import\PgImporter;
use App\Services\Media;
use App\Services\Sync;
use Illuminate\Console\Command;
use Throwable;

class ImportPostgres extends Command
{
    protected $signature = 'dwira:import-pg {dump : plain-format pg_dump file (.sql or .sql.gz)}
        {--dry-run : read and validate the dump, change nothing}
        {--fresh : empty the Dwira tables first (use only on a new install)}
        {--only= : comma separated table names (partial import, for re-runs)}
        {--r2-base= : R2_PUBLIC_BASE_URL of the old site, to download media that lived in R2}
        {--keep-admin-sessions : also import old admin sessions (default: admins sign in again)}
        {--skip-media : import data only}';

    protected $description = 'Import the old Postgres data (pg_dump) and move its media to disk, with row-count checks';

    public function handle(Media $media, Sync $sync): int
    {
        $only = $this->option('only') ? array_values(array_filter(array_map('trim', explode(',', (string) $this->option('only'))))) : null;
        $importer = new PgImporter($media, $sync, [
            'dry_run' => (bool) $this->option('dry-run'), 'fresh' => (bool) $this->option('fresh'), 'only' => $only,
            'r2_base' => $this->option('r2-base') ?: null, 'keep_admin_sessions' => (bool) $this->option('keep-admin-sessions'),
            'skip_media' => (bool) $this->option('skip-media'),
        ]);
        try {
            $r = $importer->run((string) $this->argument('dump'), fn ($t, $n) => $this->output->isVerbose() && $this->line("  $t: $n rows read"));
        } catch (Throwable $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }
        $this->line($r['dry_run'] ? 'DRY RUN - nothing was written' : 'Import finished');
        $rows = [];
        foreach ($r['tables'] as $t => $x) {
            $skipped = array_sum($x['skipped']);
            $rows[] = [$t, $x['dump'], $x['imported'], $skipped ?: '', $x['failed'] ?: '', $x['mysql'] ?? '-', $x['keys'] === null ? '-' : ($x['keys'] ? 'same' : 'DIFFERENT')];
        }
        $this->table(['table', 'in dump', 'imported', 'skipped', 'failed', 'in MySQL', 'primary keys'], $rows);
        foreach ($r['tables'] as $t => $x) {
            foreach ($x['skipped'] as $why => $n) {
                $this->line("  skipped $t: $n x $why");
            }
        }
        foreach ($r['warnings'] as $w) {
            $this->warn($w);
        }
        foreach (array_slice($r['errors'], 0, 40) as $e) {
            $this->error($e);
        }
        $this->line($r['ok'] ? '<info>OK: every row is accounted for.</info>' : '<error>FAILED: fix the errors above and re-run (use --fresh on a new install).</error>');

        return $r['ok'] ? self::SUCCESS : self::FAILURE;
    }
}
