<?php

namespace App\Services;

use App\Support\Json;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Notification campaigns (port of createCampaigns in server/campaigns.js). All state is in MySQL; `tick()` is safe to call from
 * anywhere, as often as you like (cron every minute, the sync poll, "send now"): the delivery PRIMARY KEY is the idempotency key.
 */
class Campaigns
{
    private const MAX_ATTEMPTS = 4;

    private int $localAt = 0;

    private bool $running = false;

    public function __construct(private readonly Notifier $notifier, private readonly Sync $sync, private readonly Content $content)
    {
    }

    private function clock(): int
    {
        return now_ms();
    }

    private function bump(): void
    {
        try {
            $this->sync->bump('campaigns');
        } catch (\Throwable) {
        }
    }

    /** `{...JSON.parse(row.data), id, kind, ...}` : later keys win. */
    private function campaign(object $row): array
    {
        $data = (array) Json::decode($row->data);
        foreach (['id' => $row->id, 'kind' => $row->kind, 'status' => $row->status, 'nextAt' => $row->next_at === null ? null : (int) $row->next_at, 'createdAt' => (int) $row->created_at, 'updatedAt' => (int) $row->updated_at] as $k => $v) {
            $data[$k] = $v;
        }

        return $data;
    }

    /** @return list<array<string,mixed>> */
    private function loadClients(): array
    {
        $rows = DB::select("SELECT c.id, c.name, c.created_at, c.last_seen, c.prefs,
            (SELECT COUNT(*) FROM claims k WHERE k.client_id=c.id) AS designs,
            (SELECT MIN(k.created_at) FROM claims k WHERE k.client_id=c.id) AS first_design,
            (SELECT COUNT(*) FROM subscriptions s WHERE s.owner_type='client' AND s.owner_id=c.id) AS devices
            FROM clients c WHERE c.blocked=0");

        return array_map(fn ($r) => ['id' => $r->id, 'name' => $r->name, 'prefs' => $r->prefs, 'created_at' => (int) $r->created_at, 'last_seen' => $r->last_seen === null ? null : (int) $r->last_seen, 'first_design' => $r->first_design === null ? null : (int) $r->first_design, 'designs' => (int) $r->designs, 'devices' => (int) $r->devices], $rows);
    }

    private function statsFor(array $ids): array
    {
        $out = [];
        foreach ($ids as $id) {
            $out[$id] = ['total' => 0, 'sent' => 0, 'pending' => 0, 'skipped' => 0, 'failed' => 0, 'devices' => 0];
        }
        if (! $ids) {
            return $out;
        }
        $marks = implode(',', array_fill(0, count($ids), '?'));
        foreach (DB::select("SELECT campaign_id, status, COUNT(*) AS n, COALESCE(SUM(devices),0) AS devices FROM campaign_deliveries WHERE campaign_id IN ($marks) GROUP BY campaign_id, status", array_values($ids)) as $r) {
            if (! isset($out[$r->campaign_id]) || ! array_key_exists($r->status, $out[$r->campaign_id])) {
                continue;
            }
            $out[$r->campaign_id][$r->status] = (int) $r->n;
            $out[$r->campaign_id]['total'] += (int) $r->n;
            $out[$r->campaign_id]['devices'] += (int) $r->devices;
        }

        return $out;
    }

    /** INSERT IGNORE in chunks of 200; returns the number of rows actually inserted. */
    private function insertDeliveries(string $campaignId, array $items, string $occurrence, int $nextAt, int $now): int
    {
        $inserted = 0;
        foreach (array_chunk($items, 200) as $chunk) {
            $values = [];
            $params = [];
            foreach ($chunk as $item) {
                $occ = $item['occurrence'] ?? $occurrence;
                $values[] = "(?,?,?,?,'pending',0,?,?,'[]')";
                array_push($params, "$campaignId:{$item['client']['id']}:$occ", $campaignId, $item['client']['id'], $occ, $item['at'] ?? $nextAt, $now);
            }
            $inserted += DB::affectingStatement('INSERT IGNORE INTO campaign_deliveries(id,campaign_id,client_id,occurrence,status,attempts,next_at,created_at,completed) VALUES '.implode(',', $values), $params);
        }

        return $inserted;
    }

    private function getRow(string $id): ?object
    {
        return DB::table('campaigns')->where('id', $id)->first();
    }

    private function mustGet(string $id): object
    {
        return $this->getRow($id) ?? throw fail(404, 'NOT_FOUND');
    }

    private function save(object $row, array $data, array $patch = []): void
    {
        DB::table('campaigns')->where('id', $row->id)->update([
            'data' => Json::encode($data), 'status' => $patch['status'] ?? $row->status,
            'next_at' => array_key_exists('nextAt', $patch) ? $patch['nextAt'] : $row->next_at, 'updated_at' => $this->clock(),
        ]);
    }

    // ---------------- admin operations ----------------

    public function list(): array
    {
        $rows = DB::table('campaigns')->orderByDesc('updated_at')->limit(300)->get();
        $stats = $this->statsFor($rows->pluck('id')->all());

        return $rows->map(fn ($r) => $this->campaign($r) + ['stats' => $stats[$r->id]])->all();
    }

    public function get(string $id): array
    {
        $row = $this->mustGet($id);
        $recent = DB::select('SELECT d.status, d.devices, d.sent_at, d.reason, d.occurrence, c.name FROM campaign_deliveries d JOIN clients c ON c.id=d.client_id WHERE d.campaign_id=? ORDER BY COALESCE(d.sent_at, d.created_at) DESC LIMIT 30', [$id]);

        return $this->campaign($row) + ['stats' => $this->statsFor([$id])[$id], 'recent' => array_map(fn ($r) => ['status' => $r->status, 'devices' => (int) $r->devices, 'sentAt' => $r->sent_at === null ? null : (int) $r->sent_at, 'reason' => $r->reason, 'name' => $r->name], $recent)];
    }

    public function create(mixed $body): array
    {
        $kind = $body instanceof \stdClass ? ($body->kind ?? null) : null;
        if (! in_array($kind, ['once', 'recurring', 'trigger'], true)) {
            throw fail(400, 'INVALID_KIND');
        }
        $data = CampaignRules::cleanCampaign($body, $kind);
        $id = Clients::uuid();
        $now = $this->clock();
        DB::table('campaigns')->insert(['id' => $id, 'kind' => $kind, 'data' => Json::encode($data), 'status' => 'draft', 'next_at' => null, 'created_at' => $now, 'updated_at' => $now]);
        $this->bump();

        return ($body->live ?? null) === true ? $this->activate($id) : $this->get($id);
    }

    public function update(string $id, mixed $body): array
    {
        $row = $this->mustGet($id);
        if ($row->kind === 'once' && in_array($row->status, ['sending', 'sent'], true)) {
            throw fail(409, 'CAMPAIGN_LOCKED');
        }
        $old = (array) Json::decode($row->data);
        $data = CampaignRules::cleanCampaign($body, $row->kind) + $old; // cleaned keys win, untouched ones (activatedAt, lastRun*) stay
        $live = in_array($row->status, ['scheduled', 'active'], true);
        if ($live) {
            CampaignRules::ready($data, $row->kind);
        }
        $nextAt = $row->next_at;
        if ($live && $row->kind === 'once') {
            $nextAt = $data['schedule']['at'] ?? $this->clock();
        }
        if ($live && $row->kind === 'recurring') {
            $nextAt = CampaignRules::nextRun($data['schedule'], $this->clock());
            if (! $nextAt) {
                throw fail(400, 'SCHEDULE_ENDED');
            }
        }
        $this->save($row, $data, ['nextAt' => $nextAt]);
        $this->bump();

        return $this->get($id);
    }

    public function activate(string $id): array
    {
        $row = $this->mustGet($id);
        $data = (array) Json::decode($row->data);
        $now = $this->clock();
        if (in_array($row->status, ['scheduled', 'active', 'sending'], true)) {
            return $this->get($id);
        }
        if ($row->status === 'sent') {
            throw fail(409, 'CAMPAIGN_LOCKED');
        }
        CampaignRules::ready($data, $row->kind);
        $status = 'active';
        $nextAt = null;
        if ($row->kind === 'once') {
            $status = 'scheduled';
            $nextAt = $data['schedule']['at'] ?? $now;
            if ($nextAt < $now - 5 * CampaignRules::MIN) {
                throw fail(400, 'DATE_IN_PAST');
            }
        }
        if ($row->kind === 'recurring') {
            $nextAt = CampaignRules::nextRun($data['schedule'], $now);
            if (! $nextAt) {
                throw fail(400, 'SCHEDULE_ENDED');
            }
        }
        $this->save($row, ['activatedAt' => $now] + $data, ['status' => $status, 'nextAt' => $nextAt]);
        $this->bump();

        return $this->get($id);
    }

    public function pause(string $id): array
    {
        $row = $this->mustGet($id);
        if (in_array($row->status, ['sent', 'draft', 'paused', 'ended'], true)) {
            return $this->get($id);
        }
        // Anything not yet delivered is cancelled: resuming never fires a backlog of stale messages.
        DB::table('campaign_deliveries')->where('campaign_id', $id)->where('status', 'pending')->update(['status' => 'skipped', 'reason' => 'cancelled']);
        $next = $row->kind === 'once' ? ($row->status === 'sending' ? 'sent' : 'draft') : 'paused';
        DB::table('campaigns')->where('id', $id)->update(['status' => $next, 'next_at' => null, 'updated_at' => $this->clock()]);
        $this->bump();

        return $this->get($id);
    }

    public function remove(string $id): void
    {
        if (! DB::table('campaigns')->where('id', $id)->delete()) {
            throw fail(404, 'NOT_FOUND');
        }
        $this->bump();
    }

    public function duplicate(string $id): array
    {
        $row = $this->mustGet($id);
        $data = (array) Json::decode($row->data);
        $copy = Clients::uuid();
        $now = $this->clock();
        unset($data['activatedAt'], $data['lastRunAt'], $data['lastRunCount']);
        $data['name'] = CampaignRules::text($data['name'].' (copy)', 80);
        if ($row->kind === 'once') {
            $data['schedule'] = ['at' => null, 'tz' => CampaignRules::TZ_DEFAULT];
        }
        DB::table('campaigns')->insert(['id' => $copy, 'kind' => $row->kind, 'data' => Json::encode($data), 'status' => 'draft', 'next_at' => null, 'created_at' => $now, 'updated_at' => $now]);
        $this->bump();

        return $this->get($copy);
    }

    public function preview(mixed $input): array
    {
        $audience = CampaignRules::cleanAudience($input);
        $clients = $this->loadClients();
        $matched = CampaignRules::pick($clients, $audience, $this->clock());

        return ['matched' => count($matched), 'reachable' => count(array_filter($matched, [CampaignRules::class, 'reachable'])), 'total' => count($clients), 'reachableTotal' => count(array_filter($clients, [CampaignRules::class, 'reachable']))];
    }

    public function segments(array $input = []): array
    {
        $o = CampaignRules::cleanAudience((object) ['segments' => [], 'newDays' => $input['newDays'] ?? null, 'inactiveDays' => $input['inactiveDays'] ?? null]);
        $clients = $this->loadClients();
        $now = $this->clock();
        $out = new \stdClass;
        foreach (CampaignRules::SEGMENTS as $segment) {
            $members = array_filter($clients, fn ($c) => CampaignRules::inSegment($c, $segment, $now, $o));
            $out->{$segment} = ['matched' => count($members), 'reachable' => count(array_filter($members, [CampaignRules::class, 'reachable']))];
        }

        return (array) $out;
    }

    public function people(): array
    {
        return DB::table('clients')->where('blocked', 0)->orderBy('name')->limit(500)->get(['id', 'name', 'phone'])->map(fn ($r) => ['id' => $r->id, 'name' => $r->name, 'whatsapp' => $r->phone])->all();
    }

    // ---------------- scheduler ----------------

    private function materialise(int $now): bool
    {
        $due = DB::table('campaigns')->whereIn('status', ['scheduled', 'active'])->where('kind', '<>', 'trigger')->whereNotNull('next_at')->where('next_at', '<=', $now)->orderBy('next_at')->limit(20)->get();
        $changed = false;
        foreach ($due as $row) {
            $c = $this->campaign($row);
            $occurrence = $row->kind === 'once' ? 'once' : 'r'.$row->next_at;
            $recurring = $row->kind === 'recurring';
            $next = $recurring ? CampaignRules::nextRun($c['schedule'], $now) : null;
            $skipped = $recurring && $now - (int) $row->next_at > CampaignRules::CATCH_UP;
            $audience = $skipped ? [] : array_values(array_filter(CampaignRules::pick($this->loadClients(), $c['audience'], $now), [CampaignRules::class, 'reachable']));
            $data = (array) Json::decode($row->data);
            $data['lastRunAt'] = $now;
            $data['lastRunCount'] = count($audience);
            $data['lastRunSkipped'] = $skipped;
            $status = $recurring ? ($next ? 'active' : 'ended') : 'sending';
            $won = Db::tx(function () use ($status, $next, $data, $now, $row, $audience, $occurrence) {
                // Claim: only ONE process wins this exact (next_at, updated_at) state.
                $n = DB::table('campaigns')->where('id', $row->id)->where('next_at', $row->next_at)->where('updated_at', $row->updated_at)->whereIn('status', ['scheduled', 'active'])
                    ->update(['status' => $status, 'next_at' => $next, 'data' => Json::encode($data), 'updated_at' => $now]);
                if (! $n) {
                    return false;
                }
                $this->insertDeliveries($row->id, array_map(fn ($client) => ['client' => $client], $audience), $occurrence, $now, $now);

                return true;
            });
            $changed = $changed || $won;
        }

        return $changed;
    }

    private function automations(int $now): bool
    {
        $rows = DB::table('campaigns')->where('kind', 'trigger')->where('status', 'active')->get();
        if ($rows->isEmpty()) {
            return false;
        }
        $clients = array_values(array_filter($this->loadClients(), [CampaignRules::class, 'reachable']));
        $changed = false;
        foreach ($rows as $row) {
            $c = $this->campaign($row);
            $t = $c['trigger'];
            $activatedAt = (int) ($c['activatedAt'] ?? 0);
            $since = max($activatedAt, $now - 7 * CampaignRules::DAY);
            $items = [];
            $recent = [];
            if ($t['event'] === 'inactive') {
                foreach (DB::select('SELECT client_id, MAX(created_at) AS at FROM campaign_deliveries WHERE campaign_id=? GROUP BY client_id', [$row->id]) as $r) {
                    $recent[$r->client_id] = (int) $r->at;
                }
            }
            foreach ($clients as $client) {
                $lastActive = $client['last_seen'] ?? $client['created_at'];
                $ev = $t['event'];
                if ($ev === 'signup' && $client['created_at'] >= $since && $client['created_at'] + $t['delayMinutes'] * CampaignRules::MIN <= $now) {
                    $items[] = ['client' => $client, 'occurrence' => 'once'];
                } elseif ($ev === 'first_design' && $client['first_design'] && $client['first_design'] >= $since && $client['first_design'] + $t['delayMinutes'] * CampaignRules::MIN <= $now) {
                    $items[] = ['client' => $client, 'occurrence' => 'once'];
                } elseif ($ev === 'no_design' && $client['designs'] === 0 && $client['created_at'] + $t['afterDays'] * CampaignRules::DAY <= $now && ($t['includeExisting'] || $client['created_at'] + $t['afterDays'] * CampaignRules::DAY >= $activatedAt)) {
                    $items[] = ['client' => $client, 'occurrence' => 'once'];
                } elseif ($ev === 'inactive' && $lastActive + $t['afterDays'] * CampaignRules::DAY <= $now && ($t['includeExisting'] || $lastActive + $t['afterDays'] * CampaignRules::DAY >= $activatedAt) && ! (($recent[$client['id']] ?? 0) > $now - $t['cooldownDays'] * CampaignRules::DAY)) {
                    $items[] = ['client' => $client, 'occurrence' => "ls$lastActive"];
                }
            }
            if (! $items) {
                continue;
            }
            $quiet = $t['quiet'] ? ['from' => $t['quiet'], 'to' => $t['quietTo']] : null;
            $at = CampaignRules::afterQuiet($now, $quiet);
            $items = array_map(fn ($i) => $i + ['at' => $at], $items);
            $inserted = Db::tx(fn () => $this->insertDeliveries($row->id, $items, 'once', $now, $now));
            $changed = $changed || $inserted > 0;
        }

        return $changed;
    }

    private function settle(object $d, string $status, array $patch = []): void
    {
        DB::table('campaign_deliveries')->where('id', $d->id)->update([
            'status' => $status, 'attempts' => $patch['attempts'] ?? $d->attempts, 'next_at' => $patch['nextAt'] ?? $d->next_at,
            'devices' => $patch['devices'] ?? $d->devices, 'reason' => $patch['reason'] ?? null, 'sent_at' => $patch['sentAt'] ?? null, 'completed' => $patch['completed'] ?? $d->completed,
        ]);
    }

    private function deliverDue(int $now, int $deadline): int
    {
        $paused = ! $this->notifier->enabled('client');
        $settings = $this->content->getDoc('settings');
        $capRaw = $settings->campaignCapHours ?? 24;
        $cap = (is_numeric($capRaw) ? (float) $capRaw : 24.0) * 3600000;
        $due = DB::select("SELECT d.*, c.name AS client_name FROM campaign_deliveries d JOIN clients c ON c.id=d.client_id WHERE d.status='pending' AND d.next_at<=? ORDER BY d.next_at LIMIT 200", [$now]);
        $cache = [];
        $settled = 0;
        foreach ($due as $d) {
            if ($this->clock() >= $deadline) {
                break;
            }
            $leased = DB::table('campaign_deliveries')->where('id', $d->id)->where('next_at', $d->next_at)->where('status', 'pending')->update(['next_at' => $now + 2 * CampaignRules::MIN]);
            if (! $leased) {
                continue;
            }
            if (! array_key_exists($d->campaign_id, $cache)) {
                $r = $this->getRow($d->campaign_id);
                $cache[$d->campaign_id] = $r ? $this->campaign($r) : null;
            }
            $c = $cache[$d->campaign_id];
            if (! $c) {
                $settled++;
                $this->settle($d, 'skipped', ['reason' => 'cancelled']);

                continue;
            }
            if ($paused) {
                $settled++;
                $this->settle($d, 'skipped', ['reason' => 'paused']);

                continue;
            }
            // Automations respect a frequency cap across all campaigns: postpone (up to 3 days after creation), never drop silently within that window.
            if ($c['kind'] === 'trigger' && $cap > 0) {
                $last = DB::table('campaign_deliveries')->where('client_id', $d->client_id)->where('status', 'sent')->max('sent_at');
                if ($last && (int) $last + $cap > $now) {
                    $wait = (int) ($last + $cap);
                    if ($wait > (int) $d->created_at + 3 * CampaignRules::DAY) {
                        $settled++;
                        $this->settle($d, 'skipped', ['reason' => 'capped']);
                    } else {
                        DB::table('campaign_deliveries')->where('id', $d->id)->update(['next_at' => $wait]);
                    }

                    continue;
                }
            }
            $completedIn = (array) Json::tryDecode($d->completed ?: '[]', []);
            try {
                $result = $this->notifier->deliver((object) ['id' => $c['id'], 'name' => $d->client_name, 'title' => (object) $c['title'], 'body' => (object) $c['body'], 'url' => $c['url']], $completedIn, ['event' => 'campaign', 'audience' => ['type' => 'client', 'id' => $d->client_id]]);
            } catch (\Throwable) {
                $result = ['retry' => true, 'completed' => $completedIn, 'sent' => 0];
            }
            $devices = (int) $d->devices + $result['sent'];
            $completed = Json::encode($result['completed']);
            $attempts = (int) $d->attempts + 1;
            if ($result['retry'] && $attempts < self::MAX_ATTEMPTS) {
                $this->settle($d, 'pending', ['attempts' => $attempts, 'devices' => $devices, 'completed' => $completed, 'nextAt' => $this->clock() + 60000 * 2 ** $attempts]);

                continue;
            }
            $settled++;
            if ($devices > 0) {
                $this->settle($d, 'sent', ['attempts' => $attempts, 'devices' => $devices, 'completed' => $completed, 'sentAt' => $this->clock()]);
            } else {
                $this->settle($d, $result['retry'] ? 'failed' : 'skipped', ['attempts' => $attempts, 'completed' => $completed, 'reason' => $result['retry'] ? 'delivery_failed' : 'no_device']);
            }
        }

        return $settled;
    }

    private function finalise(int $now): bool
    {
        return DB::affectingStatement("UPDATE campaigns SET status='sent', updated_at=? WHERE status='sending' AND NOT EXISTS (SELECT 1 FROM campaign_deliveries d WHERE d.campaign_id=campaigns.id AND d.status='pending')", [$now]) > 0;
    }

    /** Cross-process throttle: at most one run every 10 s (a poll from any open app triggers it). One atomic UPDATE. */
    private function claimTick(int $now): bool
    {
        Db::insertIfAbsent('settings', ['key' => 'campaign_tick', 'value' => '0']);

        return DB::affectingStatement("UPDATE settings SET value=? WHERE `key`='campaign_tick' AND CAST(value AS UNSIGNED) <= ?", [(string) $now, $now - 10000]) > 0;
    }

    /** @return array{ok?:bool,skipped?:bool,settled?:int} */
    public function tick(bool $force = false, int $budgetMs = 8000): array
    {
        $now = $this->clock();
        if ($this->running) {
            return ['skipped' => true];
        }
        if (! $force && $now - $this->localAt < 10000) {
            return ['skipped' => true];
        }
        $this->localAt = $now;
        $this->running = true;
        try {
            if (! $force && ! $this->claimTick($now)) {
                return ['skipped' => true];
            }
            $deadline = $now + $budgetMs;
            $changed = $this->materialise($now);
            $changed = $this->automations($now) || $changed;
            $settled = $this->deliverDue($now, $deadline);
            $changed = $this->finalise($now) || $settled > 0 || $changed;
            if ($changed) {
                $this->bump();
            }

            return ['ok' => true, 'settled' => $settled];
        } catch (\Throwable $e) {
            Log::warning('Campaign tick failed', ['code' => $e->getCode()]);

            return ['ok' => false];
        } finally {
            $this->running = false;
        }
    }
}
