<?php

namespace App\Services;

use App\Support\Str;
use DateTimeImmutable;
use DateTimeZone;

/** Pure rules of the campaign scheduler (port of the non-DB half of server/campaigns.js): time zones, validation, audiences. */
final class CampaignRules
{
    public const DAY = 86400000;

    public const MIN = 60000;

    public const TZ_DEFAULT = 'Africa/Casablanca';

    /** A recurring run later than this when the scheduler finally sees it is skipped. */
    public const CATCH_UP = 12 * 3600000;

    public const SEGMENTS = ['all', 'new', 'existing', 'inactive', 'image_users', 'no_image'];

    public const EVENTS = ['signup', 'first_design', 'no_design', 'inactive'];

    public const LANGS = ['dar', 'ar', 'fr'];

    /** JS Number.isInteger */
    public static function isInt(mixed $v): bool
    {
        return is_int($v) || (is_float($v) && is_finite($v) && floor($v) === $v);
    }

    public static function isSafeInt(mixed $v): bool
    {
        return self::isInt($v) && abs($v) <= 9007199254740991;
    }

    public static function int(mixed $v, int $min, int $max, int $fallback): int
    {
        return self::isInt($v) && $v >= $min && $v <= $max ? (int) $v : $fallback;
    }

    // ---- time zones ----

    /** @return array{y:int,m:int,d:int,h:int,min:int,dow:int} */
    public static function localParts(int $ts, string $tz): array
    {
        $d = (new DateTimeImmutable('@'.intdiv($ts, 1000)))->setTimezone(new DateTimeZone($tz));

        return ['y' => (int) $d->format('Y'), 'm' => (int) $d->format('n'), 'd' => (int) $d->format('j'), 'h' => (int) $d->format('G'), 'min' => (int) $d->format('i'), 'dow' => (int) $d->format('w')];
    }

    private static function offsetAt(int $ts, string $tz): int
    {
        $p = self::localParts($ts, $tz);

        return (int) (gmmktime($p['h'], $p['min'], 0, $p['m'], $p['d'], $p['y']) * 1000 - intdiv($ts, self::MIN) * self::MIN);
    }

    /** Epoch (ms) of a wall-clock time in a zone (second pass fixes the hour around DST / Ramadan changes). */
    public static function zoned(int $y, int $m, int $d, int $hh, int $mm, string $tz): int
    {
        $guess = (int) (gmmktime($hh, $mm, 0, $m, $d, $y) * 1000);
        $first = $guess - self::offsetAt($guess, $tz);

        return $guess - self::offsetAt($first, $tz);
    }

    public static function validTz(mixed $tz): bool
    {
        if (! is_string($tz) || $tz === '') {
            return false;
        }
        try {
            new DateTimeZone($tz);

            return true;
        } catch (\Throwable) {
            return false;
        }
    }

    private static function minutesOf(string $hhmm): int
    {
        [$h, $m] = array_map('intval', explode(':', $hhmm));

        return $h * 60 + $m;
    }

    public static function isTime(mixed $v): bool
    {
        return is_string($v) && preg_match('/^([01]\d|2[0-3]):[0-5]\d$/D', $v) === 1;
    }

    /** Next run strictly after `$after` for a recurring schedule, or null when it has ended. */
    public static function nextRun(array $s, int $after): ?int
    {
        $tz = $s['tz'] ?? self::TZ_DEFAULT;
        [$hh, $mm] = array_map('intval', explode(':', $s['time']));
        $startAt = (int) ($s['startAt'] ?? 0);
        $start = max($after, $startAt - 1);
        $p0 = self::localParts($start, $tz);
        for ($i = 0; $i < 400; $i++) {
            $ts = gmmktime(0, 0, 0, $p0['m'], $p0['d'] + $i, $p0['y']);
            $d = (int) gmdate('j', $ts);
            $dow = (int) gmdate('w', $ts);
            $ok = $s['freq'] === 'daily' || ($s['freq'] === 'weekly' && in_array($dow, $s['days'], true)) || ($s['freq'] === 'monthly' && $d === $s['dayOfMonth']);
            if (! $ok) {
                continue;
            }
            $at = self::zoned((int) gmdate('Y', $ts), (int) gmdate('n', $ts), $d, $hh, $mm, $tz);
            if ($at > $after && $at >= $startAt) {
                return ! empty($s['endAt']) && $at > $s['endAt'] ? null : $at;
            }
        }

        return null;
    }

    /** Moves a moment out of the quiet window (e.g. 22:00-08:00 local time) to the end of it. */
    public static function afterQuiet(int $ts, ?array $quiet, string $tz = self::TZ_DEFAULT): int
    {
        if (! $quiet) {
            return $ts;
        }
        $from = self::minutesOf($quiet['from']);
        $to = self::minutesOf($quiet['to']);
        $p = self::localParts($ts, $tz);
        $now = $p['h'] * 60 + $p['min'];
        $inside = $from < $to ? ($now >= $from && $now < $to) : ($now >= $from || $now < $to);
        if ($from === $to || ! $inside) {
            return $ts;
        }
        $t = gmmktime(0, 0, 0, $p['m'], $p['d'] + ($from > $to && $now >= $from ? 1 : 0), $p['y']);

        return self::zoned((int) gmdate('Y', $t), (int) gmdate('n', $t), (int) gmdate('j', $t), intdiv($to, 60), $to % 60, $tz);
    }

    // ---- audience ----

    /** @param array<string,mixed> $c */
    public static function reachable(array $c): bool
    {
        if ($c['devices'] <= 0) {
            return false;
        }
        $prefs = json_decode((string) ($c['prefs'] ?? '{}'), true);

        return ! (is_array($prefs) && ($prefs['notifications'] ?? null) === false);
    }

    public static function inSegment(array $c, string $segment, int $now, array $o): bool
    {
        return match ($segment) {
            'all' => true,
            'new' => $c['created_at'] >= $now - $o['newDays'] * self::DAY,
            'existing' => $c['created_at'] < $now - $o['newDays'] * self::DAY,
            'inactive' => ($c['last_seen'] ?? $c['created_at']) < $now - $o['inactiveDays'] * self::DAY,
            'image_users' => $c['designs'] > 0,
            'no_image' => $c['designs'] === 0,
            default => false,
        };
    }

    /** Union of the chosen segments and the hand-picked clients; each client appears once. */
    public static function pick(array $clients, array $audience, int $now): array
    {
        $ids = array_flip($audience['clientIds'] ?? []);
        $segments = $audience['segments'] ?? [];

        return array_values(array_filter($clients, fn ($c) => isset($ids[$c['id']]) || array_filter($segments, fn ($s) => self::inSegment($c, $s, $now, $audience))));
    }

    // ---- validation ----

    /** Control chars -> space, collapse spaces, trim, cut to `$max` code points. */
    public static function text(mixed $value, int $max): string
    {
        $s = is_string($value) ? $value : ($value === null ? '' : (is_scalar($value) ? (is_bool($value) ? ($value ? 'true' : 'false') : (string) $value) : '[object Object]'));
        $s = preg_replace('/[\x{0000}-\x{001f}\x{007f}\x{202a}-\x{202e}\x{2066}-\x{2069}]/u', ' ', $s) ?? $s;
        $s = preg_replace('/ {2,}/', ' ', $s);

        return Str::cut(Str::jsTrim($s), $max);
    }

    private static function prop(mixed $o, string $k): mixed
    {
        return $o instanceof \stdClass ? ($o->{$k} ?? null) : (is_array($o) ? ($o[$k] ?? null) : null);
    }

    private static function has(mixed $o, string $k): bool
    {
        return $o instanceof \stdClass ? property_exists($o, $k) : (is_array($o) && array_key_exists($k, $o));
    }

    public static function cleanLText(mixed $value, int $max, string $field): array
    {
        $out = [];
        foreach (self::LANGS as $lang) {
            $present = self::has($value, $lang);
            $raw = self::prop($value, $lang);
            if ($present && ! is_string($raw)) {
                throw fail(400, "INVALID_$field");
            }
            if (is_string($raw) && Str::jsLength(Str::jsTrim($raw)) > 0 && mb_strlen(Str::jsTrim($raw), 'UTF-8') > $max) {
                throw fail(400, "{$field}_TOO_LONG");
            }
            $out[$lang] = self::text($raw, $max);
        }

        return $out;
    }

    public static function hasText(array $value): bool
    {
        foreach (self::LANGS as $l) {
            if (! empty($value[$l])) {
                return true;
            }
        }

        return false;
    }

    public static function cleanAudience(mixed $input = null): array
    {
        $segs = self::prop($input, 'segments');
        $segments = array_values(array_unique(is_array($segs) ? $segs : [], SORT_REGULAR));
        foreach ($segments as $s) {
            if (! in_array($s, self::SEGMENTS, true)) {
                throw fail(400, 'INVALID_SEGMENT');
            }
        }
        $cl = self::prop($input, 'clientIds');
        $clientIds = array_values(array_unique(is_array($cl) ? $cl : [], SORT_REGULAR));
        if (count($clientIds) > 500) {
            throw fail(400, 'INVALID_CLIENTS');
        }
        foreach ($clientIds as $id) {
            if (! is_string($id) || ! preg_match('/^[a-f0-9-]{8,64}$/D', $id)) {
                throw fail(400, 'INVALID_CLIENTS');
            }
        }

        return ['segments' => $segments, 'clientIds' => $clientIds, 'newDays' => self::int(self::prop($input, 'newDays'), 1, 365, 7), 'inactiveDays' => self::int(self::prop($input, 'inactiveDays'), 1, 365, 14)];
    }

    private static function bound(mixed $v): ?int
    {
        if ($v === null) {
            return null;
        }
        if (self::isSafeInt($v) && $v > 0) {
            return (int) $v;
        }
        throw fail(400, 'INVALID_DATE');
    }

    public static function cleanSchedule(mixed $input): array
    {
        $tz = self::prop($input, 'tz') ?? self::TZ_DEFAULT;
        if (! is_string($tz) || ! self::validTz($tz)) {
            throw fail(400, 'INVALID_TIMEZONE');
        }
        $freq = self::prop($input, 'freq');
        if (! in_array($freq, ['daily', 'weekly', 'monthly'], true)) {
            throw fail(400, 'INVALID_FREQUENCY');
        }
        $time = self::prop($input, 'time');
        if (! self::isTime($time)) {
            throw fail(400, 'INVALID_TIME');
        }
        $raw = self::prop($input, 'days');
        $days = array_values(array_unique(array_map('intval', array_filter(is_array($raw) ? $raw : [], fn ($d) => self::isInt($d) && $d >= 0 && $d <= 6))));
        sort($days);
        if ($freq === 'weekly' && ! $days) {
            throw fail(400, 'INVALID_DAYS');
        }
        $dayOfMonth = self::int(self::prop($input, 'dayOfMonth'), 1, 28, 1);
        $startAt = self::bound(self::prop($input, 'startAt'));
        $endAt = self::bound(self::prop($input, 'endAt'));
        if ($startAt && $endAt && $endAt <= $startAt) {
            throw fail(400, 'INVALID_DATE');
        }

        return ['freq' => $freq, 'time' => $time, 'days' => $freq === 'weekly' ? $days : [], 'dayOfMonth' => $dayOfMonth, 'tz' => $tz, 'startAt' => $startAt, 'endAt' => $endAt];
    }

    public static function cleanTrigger(mixed $input): array
    {
        $event = self::prop($input, 'event');
        if (! in_array($event, self::EVENTS, true)) {
            throw fail(400, 'INVALID_EVENT');
        }
        $quiet = self::prop($input, 'quiet') === false ? null : ['from' => self::isTime(self::prop($input, 'quietFrom')) ? self::prop($input, 'quietFrom') : '22:00', 'to' => self::isTime(self::prop($input, 'quietTo')) ? self::prop($input, 'quietTo') : '08:00'];

        return [
            'event' => $event,
            'delayMinutes' => self::int(self::prop($input, 'delayMinutes'), 0, 14 * 24 * 60, $event === 'first_design' ? 60 : 10),
            'afterDays' => self::int(self::prop($input, 'afterDays'), 1, 365, $event === 'inactive' ? 14 : 3),
            'cooldownDays' => self::int(self::prop($input, 'cooldownDays'), 1, 365, 30),
            'includeExisting' => self::prop($input, 'includeExisting') === true,
            'quiet' => $quiet ? $quiet['from'] : null, 'quietTo' => $quiet ? $quiet['to'] : null,
        ];
    }

    public static function cleanCampaign(mixed $body, string $kind): array
    {
        if (is_array($body)) {
            throw fail(400, 'NAME_REQUIRED'); // a JS array is an object without a `name`
        }
        if (! ($body instanceof \stdClass)) {
            throw fail(400, 'INVALID_CAMPAIGN');
        }
        $name = self::text($body->name ?? null, 80);
        if ($name === '') {
            throw fail(400, 'NAME_REQUIRED');
        }
        $url = $body->url ?? null;
        $url = $url === null || $url === '' ? '/' : $url;
        if (! is_string($url) || ! preg_match(Notifier::CAMPAIGN_URL, $url)) {
            throw fail(400, 'INVALID_URL');
        }
        $out = ['name' => $name, 'title' => self::cleanLText($body->title ?? null, 60, 'TITLE'), 'body' => self::cleanLText($body->body ?? null, 140, 'BODY'), 'url' => $url];
        if ($kind === 'trigger') {
            $out['trigger'] = self::cleanTrigger($body->trigger ?? null);
        } else {
            $out['audience'] = self::cleanAudience($body->audience ?? null);
        }
        if ($kind === 'once') {
            $at = self::prop($body->schedule ?? null, 'at');
            if ($at !== null && ! (self::isSafeInt($at) && $at > 0)) {
                throw fail(400, 'INVALID_DATE');
            }
            $out['schedule'] = ['at' => $at === null ? null : (int) $at, 'tz' => self::TZ_DEFAULT];
        }
        if ($kind === 'recurring') {
            $out['schedule'] = self::cleanSchedule($body->schedule ?? null);
        }

        return $out;
    }

    /** What must be true before a campaign may go live (a draft can be saved half-written). */
    public static function ready(array $data, string $kind): void
    {
        if (! self::hasText($data['title']) || ! self::hasText($data['body'])) {
            throw fail(400, 'MESSAGE_REQUIRED');
        }
        if ($kind !== 'trigger' && ! count($data['audience']['segments']) && ! count($data['audience']['clientIds'])) {
            throw fail(400, 'AUDIENCE_REQUIRED');
        }
    }
}
