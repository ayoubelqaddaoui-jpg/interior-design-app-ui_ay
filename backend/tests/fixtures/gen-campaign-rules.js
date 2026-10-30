#!/usr/bin/env node
// Regenerates campaign-rules.json from the ORIGINAL Node implementation (server/campaigns.js).
//   cd backend && node tests/fixtures/gen-campaign-rules.js
// tests/Unit/CampaignRulesTest.php replays every case against App\Services\CampaignRules and requires identical results.
const fs = require('node:fs');
const path = require('node:path');
const c = require('../../../server/campaigns');

const HOUR = 3600000, DAY = 86400000;
const tzs = ['Africa/Casablanca', 'UTC', 'Europe/Paris', 'America/New_York', 'Asia/Kolkata'];
// Dates around daylight-saving changes (Paris/New York) and Morocco's Ramadan clock shifts.
const instants = [Date.UTC(2026, 0, 1, 0, 0), Date.UTC(2026, 1, 28, 23, 59), Date.UTC(2026, 2, 8, 6, 59), Date.UTC(2026, 2, 8, 7, 1), Date.UTC(2026, 2, 29, 0, 30),
  Date.UTC(2026, 2, 29, 1, 30), Date.UTC(2026, 9, 25, 23, 0), Date.UTC(2026, 9, 31, 12, 0), Date.UTC(2026, 10, 1, 5, 59), Date.UTC(2026, 11, 31, 23, 59, 59), Date.UTC(2028, 1, 29, 12, 0)];
// Morocco's rules after this date differ between tz database releases (Node ships its own ICU data, PHP uses the system / bundled
// one). Cases that touch Africa/Casablanca after it are tagged `tzSensitive`: the PHP test checks invariants instead of exact values.
const CUTOFF = Date.UTC(2026, 5, 30);
const sens = (tz, ...ts) => tz === 'Africa/Casablanca' && ts.some(t => typeof t === 'number' && t >= CUTOFF);
const out = { meta: { node: process.version, tzdata: process.versions.tz, icu: process.versions.icu }, localParts: [], zoned: [], nextRun: [], afterQuiet: [], inSegment: [], pick: [], clean: [], reachable: [] };

for (const tz of tzs) for (const ts of instants) out.localParts.push({ ts, tz, result: c.localParts(ts, tz), tzSensitive: sens(tz, ts) });
for (const tz of tzs) for (const [y, m, d, hh, mm] of [[2026, 3, 29, 2, 30], [2026, 3, 8, 2, 30], [2026, 11, 1, 1, 30], [2026, 10, 25, 2, 30], [2026, 6, 15, 12, 0], [2026, 2, 28, 23, 59], [2028, 2, 29, 0, 0]]) { const r = c.zoned(y, m, d, hh, mm, tz); out.zoned.push({ args: [y, m, d, hh, mm, tz], result: r, tzSensitive: sens(tz, Date.UTC(y, m - 1, d), r) }); }

const schedules = [
  { freq: 'daily', time: '09:00' }, { freq: 'daily', time: '00:00' }, { freq: 'daily', time: '23:59' },
  { freq: 'weekly', time: '08:30', days: [1, 3, 5] }, { freq: 'weekly', time: '18:00', days: [0, 6] },
  { freq: 'monthly', time: '10:00', dayOfMonth: 1 }, { freq: 'monthly', time: '10:00', dayOfMonth: 28 }, { freq: 'monthly', time: '02:30', dayOfMonth: 29 > 28 ? 15 : 15 },
  { freq: 'daily', time: '09:00', startAt: Date.UTC(2026, 5, 1), endAt: Date.UTC(2026, 5, 3, 23) },
  { freq: 'daily', time: '09:00', endAt: Date.UTC(2026, 0, 1, 1) },
  { freq: 'weekly', time: '09:00', days: [2], startAt: Date.UTC(2027, 0, 1) },
];
for (const tz of tzs) for (const s of schedules) for (const after of instants) {
  const sched = { dayOfMonth: 1, days: [], ...s, tz };
  { const r = c.nextRun(sched, after); out.nextRun.push({ schedule: sched, after, result: r, tzSensitive: sens(tz, after, r, sched.startAt, sched.endAt) || (tz === 'Africa/Casablanca' && r === null) }); }
}
for (const tz of tzs) for (const quiet of [{ from: '22:00', to: '08:00' }, { from: '01:00', to: '05:00' }, { from: '08:00', to: '08:00' }, null]) for (const ts of instants.concat(instants.map(t => t + 5 * HOUR), instants.map(t => t + 14 * HOUR)))
  { const r = c.afterQuiet(ts, quiet, tz); out.afterQuiet.push({ ts, quiet, tz, result: r, tzSensitive: sens(tz, ts, r) }); }

const NOW = Date.UTC(2026, 5, 15, 12, 0);
const clients = [
  { id: 'a1', created_at: NOW - 2 * DAY, last_seen: NOW - 1 * DAY, designs: 0, devices: 1, prefs: '{}' },
  { id: 'b2', created_at: NOW - 30 * DAY, last_seen: null, designs: 3, devices: 2, prefs: '{"notifications":false}' },
  { id: 'c3', created_at: NOW - 30 * DAY, last_seen: NOW - 20 * DAY, designs: 0, devices: 0, prefs: 'not json' },
  { id: 'd4', created_at: NOW - 7 * DAY, last_seen: NOW - 14 * DAY, designs: 1, devices: 1, prefs: '{"notifications":true}' },
  { id: 'e5', created_at: NOW - 7 * DAY - 1, last_seen: NOW, designs: 0, devices: 1, prefs: '' },
];
const opts = { newDays: 7, inactiveDays: 14 };
for (const seg of [...c.SEGMENTS, 'bogus']) for (const cl of clients) out.inSegment.push({ client: cl, segment: seg, now: NOW, opts, result: c.inSegment(cl, seg, NOW, opts) });
for (const audience of [{ segments: ['new'], clientIds: [], ...opts }, { segments: ['inactive', 'image_users'], clientIds: ['e5'], newDays: 3, inactiveDays: 10 }, { segments: [], clientIds: ['c3', 'zz'], ...opts }, { segments: ['all'], clientIds: [], ...opts }, { segments: [], clientIds: [], ...opts }])
  out.pick.push({ audience, now: NOW, result: c.pick(clients, audience, NOW).map(x => x.id) });
for (const cl of clients) out.reachable.push({ client: cl, result: c.reachable(cl) });

const L = (fr, ar, dar) => ({ fr, ar, dar });
const base = { name: 'Promo', title: L('Salut', '', ''), body: L('Corps', '', ''), url: '/' };
const cases = [
  ['once', base], ['once', { ...base, schedule: { at: 1790000000000 } }], ['once', { ...base, schedule: { at: -5 } }], ['once', { ...base, schedule: { at: 1.5 } }], ['once', { ...base, schedule: { at: null } }],
  ['once', { ...base, audience: { segments: ['new', 'new', 'all'], clientIds: ['abcdef12', 'abcdef12'], newDays: 400, inactiveDays: 0 } }],
  ['once', { ...base, audience: { segments: ['nope'] } }], ['once', { ...base, audience: { clientIds: ['XYZ'] } }], ['once', { ...base, audience: { clientIds: Array.from({ length: 501 }, (_, i) => (i + 1e8).toString(16).padStart(8, 'a')) } }],
  ['once', { ...base, name: '   ' }], ['once', { ...base, name: 'a\u0000b\u202ec  d ' + 'x'.repeat(100) }], ['once', { ...base, url: '/explore' }], ['once', { ...base, url: '/tool/abc_DEF-1' }], ['once', { ...base, url: 'https://evil.example' }], ['once', { ...base, url: '/history/' }], ['once', { ...base, url: 5 }], ['once', { ...base, url: '' }], ['once', { ...base, url: null }],
  ['once', { ...base, title: { fr: 5 } }], ['once', { ...base, title: { fr: 'x'.repeat(61) } }], ['once', { ...base, body: { ar: 'é'.repeat(141) } }], ['once', { ...base, title: { fr: 'ن'.repeat(60), ar: ' مرحبا ', dar: 'a\tb' } }], ['once', { ...base, title: null }], ['once', { ...base, title: { fr: '😀'.repeat(60) } }], ['once', { ...base, title: { fr: '😀'.repeat(61) } }],
  ['once', null], ['once', 'str'], ['once', []],
  ['recurring', { ...base, schedule: { freq: 'daily', time: '09:00' } }], ['recurring', { ...base, schedule: { freq: 'weekly', time: '09:00', days: [3, 1, 3, 9, 'x', 1.5] } }], ['recurring', { ...base, schedule: { freq: 'weekly', time: '09:00', days: [] } }],
  ['recurring', { ...base, schedule: { freq: 'monthly', time: '09:00', dayOfMonth: 31 } }], ['recurring', { ...base, schedule: { freq: 'monthly', time: '09:00', dayOfMonth: 12 } }], ['recurring', { ...base, schedule: { freq: 'hourly', time: '09:00' } }], ['recurring', { ...base, schedule: { freq: 'daily', time: '9:00' } }],
  ['recurring', { ...base, schedule: { freq: 'daily', time: '24:00' } }], ['recurring', { ...base, schedule: { freq: 'daily', time: '09:00', tz: 'Mars/Base' } }], ['recurring', { ...base, schedule: { freq: 'daily', time: '09:00', tz: 'Europe/Paris' } }], ['recurring', { ...base, schedule: { freq: 'daily', time: '09:00', tz: 5 } }],
  ['recurring', { ...base, schedule: { freq: 'daily', time: '09:00', startAt: 100, endAt: 50 } }], ['recurring', { ...base, schedule: { freq: 'daily', time: '09:00', startAt: 100, endAt: 200 } }], ['recurring', { ...base, schedule: { freq: 'daily', time: '09:00', startAt: -1 } }], ['recurring', { ...base, schedule: { freq: 'daily', time: '09:00', endAt: 2 ** 60 } }], ['recurring', base], ['recurring', { ...base, schedule: null }],
  ['trigger', { ...base, trigger: { event: 'signup' } }], ['trigger', { ...base, trigger: { event: 'first_design' } }], ['trigger', { ...base, trigger: { event: 'inactive', afterDays: 30, cooldownDays: 5, includeExisting: true } }],
  ['trigger', { ...base, trigger: { event: 'no_design', quiet: false } }], ['trigger', { ...base, trigger: { event: 'signup', quietFrom: '23:30', quietTo: '07:15' } }], ['trigger', { ...base, trigger: { event: 'signup', quietFrom: 'bad', quietTo: '25:00' } }],
  ['trigger', { ...base, trigger: { event: 'signup', delayMinutes: 99999999, afterDays: 0, cooldownDays: 400, includeExisting: 'yes' } }], ['trigger', { ...base, trigger: { event: 'nope' } }], ['trigger', base], ['trigger', { ...base, trigger: null }],
];
for (const [kind, body] of cases) {
  let result, error;
  let crash = false;
  try { result = c.cleanCampaign(JSON.parse(JSON.stringify(body)), kind); } catch (e) { error = e.message; crash = !e.status; }
  // `crash`: the Node code threw a TypeError (the API answers 500 "Server error"). Laravel answers a clean 400 instead.
  out.clean.push({ kind, body, result, error: crash ? undefined : error, crash });
}
fs.writeFileSync(path.join(__dirname, 'campaign-rules.json'), JSON.stringify(out));
console.log(Object.entries(out).map(([k, v]) => `${k}=${v.length}`).join(' '));
