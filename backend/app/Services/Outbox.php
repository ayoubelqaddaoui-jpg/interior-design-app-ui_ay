<?php

namespace App\Services;

use App\Support\Json;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Notification queue (port of enqueue()/pump() in server/index.js). No worker needed: jobs are delivered inline with a bounded
 * wait, and whatever is left is retried by the cron `schedule:run` (every minute) with the same lease and backoff rules.
 */
class Outbox
{
    public function __construct(private readonly Notifier $notifier)
    {
    }

    /** Job keys longer than 180 characters are stored as `h:<sha1>` (the column is indexed). */
    public static function key(string $jobId): string
    {
        return strlen($jobId) > 180 ? 'h:'.sha1($jobId) : $jobId;
    }

    public function enqueue(string $kind, string $jobId, mixed $payload = null): void
    {
        Db::insertIfAbsent('outbox', ['request_id' => self::key($jobId), 'attempts' => 0, 'next_at' => now_ms(), 'completed' => '[]', 'kind' => $kind, 'payload' => $payload === null ? null : Json::encode($payload)]);
    }

    public function hasDue(): bool
    {
        return DB::table('outbox')->where('next_at', '<=', now_ms())->exists();
    }

    /** Deliver due jobs. A 60 s lease stops concurrent processes from sending the same job twice. */
    public function pump(?string $only = null, int $budgetMs = 20000): void
    {
        $started = now_ms();
        try {
            $now = now_ms();
            $q = DB::table('outbox')->where('next_at', '<=', $now);
            $due = $only !== null ? $q->where('request_id', self::key($only))->get() : $q->orderBy('next_at')->limit(20)->get();
            foreach ($due as $job) {
                if (now_ms() - $started > $budgetMs) {
                    break;
                }
                $leased = DB::table('outbox')->where('request_id', $job->request_id)->where('next_at', $job->next_at)->update(['next_at' => $now + 60000]);
                if (! $leased) {
                    continue;
                }
                $item = null;
                $options = [];
                if ($job->kind === 'request') {
                    $row = DB::table('requests')->where('id', $job->request_id)->value('data');
                    if ($row !== null) {
                        $item = Json::decode($row);
                        $options = ['event' => 'request'];
                    }
                } else {
                    $payload = Json::tryDecode($job->payload);
                    if ($payload !== null) {
                        $item = $payload;
                        $options = ['event' => $job->kind] + (isset($payload->audience) ? ['audience' => (array) $payload->audience] : []);
                    }
                }
                if ($item === null) {
                    DB::table('outbox')->where('request_id', $job->request_id)->delete();

                    continue;
                }
                try {
                    $result = $this->notifier->deliver($item, (array) Json::tryDecode($job->completed, []), $options);
                    if (! $result['retry'] || $job->attempts >= 6) {
                        DB::table('outbox')->where('request_id', $job->request_id)->delete();
                    } else {
                        DB::table('outbox')->where('request_id', $job->request_id)->update([
                            'completed' => Json::encode($result['completed']), 'attempts' => DB::raw('attempts + 1'),
                            'next_at' => now_ms() + min(3600000, 30000 * 2 ** ($job->attempts + 1)),
                        ]);
                    }
                } catch (\Throwable) {
                    Log::warning('Notification job deferred');
                }
            }
        } catch (\Throwable) {
            Log::warning('Notification queue temporarily unavailable');
        }
    }

    /**
     * Deliver ONE job right after the response has been sent (Laravel's terminate phase runs after `fastcgi_finish_request` /
     * `litespeed_finish_request`), so a slow push service never delays the user. The job is already durable in the outbox: if
     * the process dies first, the cron `schedule:run` retries it (same lease and backoff rules).
     */
    public function afterResponse(string $jobId): void
    {
        app()->terminating(fn () => $this->pump($jobId, (int) config('dwira.push_wait_ms', 8000)));
    }
}
