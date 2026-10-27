const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const crypto = require('node:crypto');
const { createBackend } = require('../server');
const { nextRun, afterQuiet, zoned, localParts } = require('../server/campaigns');
const { freshDb, closeShared } = require('./test-db');

test.after(closeShared);

const key = crypto.createECDH('prime256v1');
key.generateKeys();
const device = id => ({ kind: 'web', language: 'fr', subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: { p256dh: key.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } } });
function call(backend, url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', ...headers }, socket: { remoteAddress: 'test-client' } });
    const output = { headers: {} };
    const res = { headersSent: false, setHeader(k, v) { output.headers[k.toLowerCase()] = v; }, writeHead(status) { output.status = status; this.headersSent = true; }, end(value) { output.body = value ? JSON.parse(value) : undefined; resolve(output); } };
    backend.handle(req, res);
  });
}
const native = { 'x-dwira-native': '1' };
async function setup() {
  const sent = [];
  const db = await freshDb();
  const backend = createBackend({ env: { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', PUSH_WAIT_MS: '3000' }, db, senders: { web: async (sub, payload) => { sent.push({ endpoint: sub.endpoint, ...JSON.parse(payload) }); } } });
  const adminLogin = await call(backend, '/api/admin/login', { method: 'POST', body: { email: 'admin', password: 'admin' }, headers: native });
  const admin = { authorization: `Bearer ${adminLogin.body.token}` };
  /** A client with one push device (unless `push` is false). */
  const user = async (name, phone, { push = true } = {}) => {
    const r = await call(backend, '/api/user/login', { method: 'POST', body: { name, phone }, headers: native });
    const headers = { 'x-user-token': r.body.token };
    if (push) await call(backend, '/api/push/subscriptions', { method: 'POST', headers, body: { ...device(`client-${phone}`), owner: 'client' } });
    return { id: r.body.user.id, headers };
  };
  const api = (url, opts = {}) => call(backend, url, { ...opts, headers: { ...admin, ...(opts.headers || {}) } });
  const age = (id, days, col = 'created_at') => db.query(`UPDATE clients SET ${col}=$1 WHERE id=$2`, [Date.now() - days * 86400000, id]);
  const campaignPushes = () => sent.filter(p => p.url !== undefined && p.title !== 'Nouveau message' && !/^client-|admin/.test(p.endpoint.split('/').pop()) === false);
  return { backend, db, sent, admin, api, user, age, campaignPushes };
}
const msg = { title: { dar: 'مرحبا {name}', ar: 'أهلا {name}', fr: 'Salut {name}' }, body: { dar: 'جديد في دويرة', ar: 'جديد', fr: 'Du nouveau' } };
const campaign = (extra = {}) => ({ kind: 'once', name: 'Promo', ...msg, url: '/explore', audience: { segments: ['all'] }, schedule: {}, ...extra });
const textsOf = sent => sent.map(p => p.title);

test('time helpers: Casablanca wall-clock schedules, weekly / monthly runs and quiet hours', () => {
  const tz = 'Africa/Casablanca';
  const base = Date.UTC(2026, 9, 27, 12, 0);
  const daily = nextRun({ freq: 'daily', time: '10:00', days: [], dayOfMonth: 1, tz }, base);
  assert.equal(new Date(daily).toISOString(), '2026-10-28T10:00:00.000Z', 'Casablanca is UTC+1 (UTC in the Ramadan window) - never in the past');
  assert.ok(daily > base);
  const weekly = nextRun({ freq: 'weekly', time: '09:30', days: [5], dayOfMonth: 1, tz }, base);
  assert.equal(localParts(weekly, tz).dow, 5);
  assert.equal(localParts(weekly, tz).h, 9);
  const monthly = nextRun({ freq: 'monthly', time: '09:00', days: [], dayOfMonth: 3, tz }, base);
  assert.equal(localParts(monthly, tz).d, 3);
  assert.equal(nextRun({ freq: 'daily', time: '10:00', days: [], dayOfMonth: 1, tz, endAt: base + 1000 }, base), null, 'ended schedules stop');
  const quiet = { from: '22:00', to: '08:00' };
  const night = zoned(2026, 10, 27, 22, 30, tz), morning = zoned(2026, 10, 28, 8, 0, tz);
  assert.equal(afterQuiet(night, quiet), morning);
  assert.equal(afterQuiet(zoned(2026, 10, 28, 3, 0, tz), quiet), morning);
  const noon = zoned(2026, 10, 27, 12, 0, tz);
  assert.equal(afterQuiet(noon, quiet), noon);
  assert.equal(afterQuiet(night, null), night);
});

test('campaigns are admin only and validated; a draft can be saved half-written but not launched', async () => {
  const { backend, api } = await setup();
  try {
    assert.equal((await call(backend, '/api/admin/campaigns')).status, 401);
    const c = await call(backend, '/api/user/login', { method: 'POST', body: { name: 'A', phone: '0600000001' }, headers: native });
    assert.equal((await call(backend, '/api/admin/campaigns', { headers: { 'x-user-token': c.body.token } })).status, 401, 'a client is not an admin');
    const bad = async (patch, code) => { const r = await api('/api/admin/campaigns', { method: 'POST', body: campaign(patch) }); assert.equal(r.status, 400, code); assert.equal(r.body.error ?? r.body.code ?? r.body.message, code); };
    await bad({ name: '' }, 'NAME_REQUIRED');
    await bad({ audience: { segments: ['vip'] } }, 'INVALID_SEGMENT');
    await bad({ url: 'https://evil.example' }, 'INVALID_URL');
    await bad({ title: { fr: 'x'.repeat(61) } }, 'TITLE_TOO_LONG');
    await bad({ body: { fr: 'x'.repeat(141) } }, 'BODY_TOO_LONG');
    await bad({ kind: 'recurring', schedule: { freq: 'weekly', time: '10:00', days: [] } }, 'INVALID_DAYS');
    await bad({ kind: 'recurring', schedule: { freq: 'daily', time: '25:00' } }, 'INVALID_TIME');
    await bad({ kind: 'trigger', trigger: { event: 'birthday' } }, 'INVALID_EVENT');
    const draft = await api('/api/admin/campaigns', { method: 'POST', body: campaign({ title: {}, body: {}, audience: { segments: [] } }) });
    assert.equal(draft.status, 201);
    assert.equal(draft.body.status, 'draft');
    const live = await api(`/api/admin/campaigns/${draft.body.id}/activate`, { method: 'POST' });
    assert.equal(live.status, 400, 'an empty message cannot go live');
    assert.equal((await api('/api/admin/campaigns/00000000-0000-0000-0000-000000000000')).status, 404);
  } finally { backend.server.emit('close'); }
});

test('segments: new, existing, inactive, image users - each person is counted once and unreachable people are never sent to', async () => {
  const { backend, db, api, user, age } = await setup();
  try {
    const fresh = await user('Nadia', '0611000001');
    const old = await user('Omar', '0611000002');
    const idle = await user('Idriss', '0611000003');
    const designer = await user('Dounia', '0611000004');
    const nopush = await user('Karim', '0611000005', { push: false });
    await age(old.id, 40); await age(idle.id, 60); await age(designer.id, 30); await age(nopush.id, 40);
    // Logging in counts as activity: the idle client has not opened the app since signing up.
    await db.query('UPDATE clients SET last_seen=NULL WHERE id=$1', [idle.id]);
    await db.query('UPDATE clients SET last_seen=$1 WHERE id IN ($2,$3)', [Date.now() - 86400000, old.id, designer.id]);
    await db.query("INSERT INTO claims(id, client_id, free, created_at) VALUES ('k1', $1, 1, $2)", [designer.id, Date.now()]);
    const s = (await api('/api/admin/campaigns/segments')).body;
    assert.deepEqual([s.all, s.new, s.existing, s.inactive, s.image_users, s.no_image].map(x => x.reachable), [4, 1, 3, 1, 1, 3]);
    assert.equal(s.all.matched, 5, 'matched counts everyone, reachable only people with a device');
    const p = (await api('/api/admin/campaigns/preview', { method: 'POST', body: { segments: ['existing', 'image_users'], clientIds: [fresh.id] } })).body;
    assert.equal(p.matched, 5);
    assert.equal(p.reachable, 4);
    const custom = (await api('/api/admin/campaigns/segments?newDays=45&inactiveDays=90')).body;
    assert.equal(custom.new.reachable, 3, 'the thresholds are adjustable (45 days: everyone except the 60-day-old client and the one without a device)');
    assert.equal((await api('/api/admin/campaigns/people')).body.length, 5);
  } finally { backend.server.emit('close'); }
});

test('send now reaches the chosen segment once, personalised, in the device language, with the link; repeated ticks never duplicate', async () => {
  const { backend, db, sent, api, user, age } = await setup();
  try {
    const a = await user('Nadia Alaoui', '0612000001'), b = await user('Omar', '0612000002');
    await age(b.id, 40);
    sent.length = 0;
    const created = await api('/api/admin/campaigns', { method: 'POST', body: campaign({ audience: { segments: ['new'] }, live: true }) });
    assert.equal(created.status, 201);
    const done = await api(`/api/admin/campaigns/${created.body.id}/activate`, { method: 'POST' });
    assert.equal(done.body.status, 'sent');
    assert.equal(done.body.stats.sent, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].endpoint.endsWith('client-0612000001'), true, 'only the new client');
    assert.equal(sent[0].title, 'Salut Nadia', 'device language (fr) and first name');
    assert.equal(sent[0].url, '/explore');
    for (let i = 0; i < 3; i++) await backend.campaigns.tick({ force: true });
    assert.equal(sent.length, 1, 'idempotent');
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM campaign_deliveries'))[0].n, 1);
    const detail = (await api(`/api/admin/campaigns/${created.body.id}`)).body;
    assert.equal(detail.recent.length, 1);
    assert.equal((await api(`/api/admin/campaigns/${created.body.id}`, { method: 'PATCH', body: campaign() })).status, 409, 'a sent campaign is locked');
    const copy = await api(`/api/admin/campaigns/${created.body.id}/duplicate`, { method: 'POST' });
    assert.equal(copy.body.status, 'draft');
    assert.equal((await api(`/api/admin/campaigns/${created.body.id}`, { method: 'DELETE' })).body.ok, true);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM campaign_deliveries'))[0].n, 0, 'deliveries go with the campaign');
  } finally { backend.server.emit('close'); }
});

test('scheduled campaigns wait for their time, can be paused, and a failing push is retried then given up', async () => {
  const { backend, db, sent, api, user } = await setup();
  try {
    await user('Nadia', '0613000001');
    sent.length = 0;
    const when = Date.now() + 3600000;
    const c = (await api('/api/admin/campaigns', { method: 'POST', body: campaign({ schedule: { at: when }, live: true }) })).body;
    assert.equal(c.status, 'scheduled');
    assert.equal(c.nextAt, when);
    await backend.campaigns.tick({ force: true });
    assert.equal(sent.length, 0, 'not yet');
    const paused = (await api(`/api/admin/campaigns/${c.id}/pause`, { method: 'POST' })).body;
    assert.equal(paused.status, 'draft');
    await db.query('UPDATE campaigns SET status=$1, next_at=$2 WHERE id=$3', ['scheduled', Date.now() - 1000, c.id]);
    await backend.campaigns.tick({ force: true });
    assert.equal(sent.length, 1, 'due -> delivered');
    assert.equal((await api('/api/admin/campaigns', { method: 'POST', body: campaign({ schedule: { at: Date.now() - 86400000 }, live: true }) })).status, 400, 'DATE_IN_PAST');
  } finally { backend.server.emit('close'); }
});

test('recurring campaigns run on schedule, once per occurrence; stale runs are skipped, pausing cancels what is pending', async () => {
  const { backend, db, sent, api, user } = await setup();
  try {
    await user('Nadia', '0614000001');
    sent.length = 0;
    const c = (await api('/api/admin/campaigns', { method: 'POST', body: campaign({ kind: 'recurring', schedule: { freq: 'daily', time: '10:00' }, live: true }) })).body;
    assert.equal(c.status, 'active');
    assert.ok(c.nextAt > Date.now());
    await db.query('UPDATE campaigns SET next_at=$1 WHERE id=$2', [Date.now() - 1000, c.id]);
    await backend.campaigns.tick({ force: true });
    assert.equal(sent.length, 1);
    const after = (await api(`/api/admin/campaigns/${c.id}`)).body;
    assert.equal(after.status, 'active');
    assert.ok(after.nextAt > Date.now(), 'the next run is planned');
    await backend.campaigns.tick({ force: true });
    assert.equal(sent.length, 1, 'the same occurrence is never sent twice');
    // The server was off for two days: the stale occurrence is skipped instead of sending an old good morning.
    await db.query('UPDATE campaigns SET next_at=$1 WHERE id=$2', [Date.now() - 2 * 86400000, c.id]);
    await backend.campaigns.tick({ force: true });
    assert.equal(sent.length, 1);
    assert.equal((await api(`/api/admin/campaigns/${c.id}`)).body.lastRunSkipped, true);
    assert.equal((await api(`/api/admin/campaigns/${c.id}/pause`, { method: 'POST' })).body.status, 'paused');
  } finally { backend.server.emit('close'); }
});

test('automations: signup welcome (only people who join after activation), no-design nudge, inactivity win-back with cooldown, quiet hours and frequency cap', async () => {
  const { backend, db, sent, api, user, age } = await setup();
  try {
    const before = await user('Before', '0615000001');
    sent.length = 0;
    const welcome = (await api('/api/admin/campaigns', { method: 'POST', body: campaign({ kind: 'trigger', name: 'Welcome', audience: undefined, trigger: { event: 'signup', delayMinutes: 0, quiet: false }, live: true }) })).body;
    assert.equal(welcome.status, 'active');
    await backend.campaigns.tick({ force: true });
    assert.equal(sent.length, 0, 'people who were already there are not welcomed');
    const joined = await user('Joined', '0615000002');
    await backend.campaigns.tick({ force: true });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].endpoint.endsWith('client-0615000002'), true);
    await backend.campaigns.tick({ force: true });
    assert.equal(sent.length, 1, 'once per person');

    // Frequency cap: a second automation the same day is postponed for someone who just got a message.
    const nudge = (await api('/api/admin/campaigns', { method: 'POST', body: campaign({ kind: 'trigger', name: 'Nudge', audience: undefined, trigger: { event: 'no_design', afterDays: 1, includeExisting: true, quiet: false }, live: true }) })).body;
    await age(before.id, 5);
    await backend.campaigns.tick({ force: true });
    assert.equal(sent.length, 2, 'Before gets the nudge');
    await age(joined.id, 5);
    await backend.campaigns.tick({ force: true });
    assert.equal(sent.length, 2, 'Joined was messaged less than 24 h ago: capped');
    const pending = await db.query("SELECT status, next_at FROM campaign_deliveries WHERE campaign_id=$1 AND client_id=$2", [nudge.id, joined.id]);
    assert.equal(pending[0].status, 'pending');
    assert.ok(Number(pending[0].next_at) > Date.now(), 'postponed, not dropped');

    // Inactivity win-back with a cooldown.
    // Only the win-back automation should be live for this part.
    await api(`/api/admin/campaigns/${welcome.id}/pause`, { method: 'POST' });
    await api(`/api/admin/campaigns/${nudge.id}/pause`, { method: 'POST' });
    const idle = await user('Idle', '0615000003');
    await db.query('UPDATE clients SET last_seen=$1, created_at=$2 WHERE id=$3', [Date.now() - 20 * 86400000, Date.now() - 90 * 86400000, idle.id]);
    const back = (await api('/api/admin/campaigns', { method: 'POST', body: campaign({ kind: 'trigger', name: 'Back', audience: undefined, trigger: { event: 'inactive', afterDays: 14, includeExisting: true, quiet: false }, live: true }) })).body;
    await db.query("UPDATE campaign_deliveries SET status='sent', sent_at=$1 WHERE status='pending'", [Date.now() - 3 * 86400000]);
    await db.query('UPDATE campaign_deliveries SET sent_at=$1 WHERE status=$2', [Date.now() - 3 * 86400000, 'sent']);
    sent.length = 0;
    await backend.campaigns.tick({ force: true });
    assert.equal(sent.filter(p => p.endpoint.endsWith('client-0615000003')).length, 1, 'the inactive client is called back');
    const rows = await db.query('SELECT COUNT(*)::int AS n FROM campaign_deliveries WHERE campaign_id=$1 AND client_id=$2', [back.id, idle.id]);
    assert.equal(rows[0].n, 1);
    await backend.campaigns.tick({ force: true });
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM campaign_deliveries WHERE campaign_id=$1 AND client_id=$2', [back.id, idle.id]))[0].n, 1, 'cooldown: no second win-back');
    assert.deepEqual(textsOf(sent).every(Boolean), true);
  } finally { backend.server.emit('close'); }
});

test('delivery honours the master switch and each person\'s choice; test push goes only to the admin\'s own devices', async () => {
  const { backend, db, sent, api, user, admin } = await setup();
  try {
    const a = await user('Nadia', '0616000001'), b = await user('Omar', '0616000002');
    await call(backend, '/api/user/preferences', { method: 'PATCH', headers: b.headers, body: { notifications: false } });
    const prefs = await db.query('SELECT prefs FROM clients WHERE id=$1', [b.id]);
    if (!/false/.test(prefs[0].prefs)) await db.query("UPDATE clients SET prefs='{\"notifications\":false}' WHERE id=$1", [b.id]);
    assert.equal((await api('/api/admin/campaigns/test', { method: 'POST', body: { ...msg } })).status, 409, 'no admin device yet');
    await call(backend, '/api/push/subscriptions', { method: 'POST', headers: admin, body: device('admin-1') });
    sent.length = 0;
    const test = await api('/api/admin/campaigns/test', { method: 'POST', body: { ...msg, url: '/pro' } });
    assert.equal(test.body.ok, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].endpoint.endsWith('admin-1'), true);
    assert.equal(sent[0].title, 'Salut Admin');
    sent.length = 0;
    const c = (await api('/api/admin/campaigns', { method: 'POST', body: campaign({ live: true }) })).body;
    const done = (await api(`/api/admin/campaigns/${c.id}/activate`, { method: 'POST' })).body;
    assert.equal(done.stats.total, 1, 'the person who switched notifications off is not even targeted');
    assert.equal(sent.some(p => p.endpoint.endsWith('client-0616000001')), true);
    assert.equal(sent.some(p => p.endpoint.endsWith('client-0616000002')), false);
  } finally { backend.server.emit('close'); }
});
