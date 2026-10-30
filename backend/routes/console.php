<?php

use App\Services\Campaigns;
use App\Services\Outbox;
use Illuminate\Support\Facades\Schedule;

/*
 * hPanel cron (every minute):   * * * * * /usr/bin/php /home/USER/domains/SITE/laravel/artisan schedule:run >/dev/null 2>&1
 *
 * One job does everything the Node timer did every 15 s: retry failed notifications and run the campaign scheduler. It loops
 * for ~50 s inside the minute so delivery latency stays close to the old one without a long-running worker.
 */
Schedule::call(function () {
    $deadline = microtime(true) + 50;
    do {
        try {
            $outbox = app(Outbox::class);
            if ($outbox->hasDue()) {
                $outbox->pump(null, 15000);
            }
            app(Campaigns::class)->tick(true, 15000);
        } catch (Throwable) {
            // already logged (redacted) by the services; the next pass retries
        }
        if (microtime(true) + 15 >= $deadline) {
            break;
        }
        sleep(15);
    } while (true);
})->name('dwira-background')->everyMinute()->withoutOverlapping(2);
