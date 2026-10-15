const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { createClients } = require('../server/clients');
const { createReturning } = require('../server/returning');
const { createBackend } = require('../server');
const root = path.resolve('.pw');
fs.mkdirSync(root, { recursive: true });
const text = { headline: 'Welcome {name}', body: '{remaining} · {price}', benefits: ['One'], primary: 'Upgrade', secondary: 'Later' };
const version = (id, weight, enabled = true) => ({ id, label: id, weight, enabled, texts: { dar: { ...text }, ar: { ...text }, fr: { ...text } } });
const client = (phone = '+212612345678') => ({ whatsapp: phone, freeUsed: 1 });
function call(backend, url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', ...headers }, socket: { remoteAddress: 'returning-test' } });
    const output = { headers: {} };
    const res = { headersSent: false, setHeader(key, value) { output.headers[key.toLowerCase()] = value; }, writeHead(status) { output.status = status; this.headersSent = true; }, end(value) { output.body = value ? JSON.parse(value) : undefined; resolve(output); } };
    backend.server.emit('request', req, res);
  });
}
test('weighted assignment: exact boundaries, zero weights, one/none active, stable phones, cache invalidation', () => {
  const clients = createClients(':memory:');
  let n = 0;
  const returning = createReturning(clients.db, () => (n++ % 100) / 100);
  try {
    returning.save([version('A', 25), version('B', 75), version('C', 0)]);
    const counts = { A: 0, B: 0, C: 0 };
    for (let i = 0; i < 1000; i++) {
      const profile = client(`+2126${String(i).padStart(8, '0')}`);
      const first = returning.message(profile).version;
      counts[first.id]++;
      for (let j = 0; j < 3; j++) assert.equal(returning.message(profile).version.id, first.id);
    }
    assert.deepEqual(counts, { A: 250, B: 750, C: 0 });
    assert.equal(returning.message({ ...client(), freeUsed: 0 }).eligible, false);
    returning.save([version('A', 0, false), version('B', 1)]);
    assert.equal(returning.message(client('+212799999999')).version.id, 'B');
    assert.equal(returning.message(client('+212600000000')).version, null, 'disabled assignment falls back, never reassigned');
    returning.save([]);
    assert.equal(returning.message(client('+212788888888')).version, null);
    assert.throws(() => returning.save([version('A', 100)]), /VERSION_DELETED/);
    assert.equal(clients.db.prepare('SELECT COUNT(*) AS n FROM returning_assignments WHERE phone=?').get('+212788888888').n, 0);
    const indexes = clients.db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(row => row.name);
    assert(indexes.includes('returning_phone') && indexes.includes('returning_version_id'));
  } finally { clients.close(); }
});
test('real RNG weights within tolerance and persistent canonical phone after logout/restart', () => {
  const dir = fs.mkdtempSync(path.join(root, 'returning-persist-'));
  const file = path.join(dir, 'clients.sqlite');
  let clients = createClients(file);
  try {
    let returning = createReturning(clients.db);
    returning.save([version('A', 20), version('B', 80)]);
    let a = 0;
    for (let i = 0; i < 5000; i++) if (returning.message(client(`+336${String(i).padStart(8, '0')}`)).version.id === 'A') a++;
    assert(a > 850 && a < 1150, `20% random weight out of tolerance: ${a}/5000`);
    const login = clients.login('Samira', '0612345678');
    clients.db.prepare('UPDATE clients SET free_used=1 WHERE id=?').run(login.user.id);
    const assigned = returning.message(clients.user(login.user.id)).version.id;
    clients.logout(login.token); clients.close(); clients = createClients(file); returning = createReturning(clients.db);
    const restored = clients.login('Samira', '00212612345678');
    assert.equal(returning.message(restored.user).version.id, assigned);
  } finally { clients.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('unique phone counters, idempotent retries, funnel ownership, date filtering, deleted historical results and text validation', () => {
  const clients = createClients(':memory:');
  const returning = createReturning(clients.db);
  try {
    const a = version('A', 100);
    a.texts.fr.headline = '<script>x</script>' + 'y'.repeat(500);
    assert.equal(returning.save([a])[0].texts.fr.headline.length, 120);
    assert(!returning.versions()[0].texts.fr.headline.includes('<'));
    assert.throws(() => returning.save([version('A', 20), version('B', 20)]), /WEIGHTS_MUST_TOTAL_100/);
    const bad = version('B', 100); delete bad.texts.ar;
    assert.throws(() => returning.save([bad]), /ALL_LANGUAGES_REQUIRED/);
    const tooMany = version('B', 100); tooMany.texts.fr.benefits = ['1', '2', '3', '4', '5'];
    assert.throws(() => returning.save([tooMany]), /ALL_LANGUAGES_REQUIRED/);
    returning.message(client());
    assert.throws(() => returning.event(client(), 'A', 'upgrade_confirmation'), /FUNNEL_REQUIRED/);
    assert.throws(() => returning.event(client('+212611111111'), 'A', 'view'), /ASSIGNMENT_REQUIRED/);
    for (const event of ['view', 'click', 'upgrade_confirmation']) for (let i = 0; i < 3; i++) returning.event(client(), 'A', event);
    assert.deepEqual(returning.results()[0], { id: 'A', label: 'A', deleted: false, views: 1, clicks: 1, purchases: 1, conversion: 100 });
    const date = new Date().toISOString().slice(0, 10);
    assert.equal(returning.results(date, date)[0].purchases, 1);
    assert.equal(returning.results('2099-01-01', '2099-12-31')[0].purchases, 0);
    assert.throws(() => returning.results('2026-02-30'), /INVALID_DATE/);
    assert.throws(() => returning.results('2026-12-01', '2026-01-01'), /INVALID_DATE/);
    returning.save([]);
    assert.equal(returning.results()[0].deleted, true);
    assert.equal(returning.results()[0].purchases, 1);
  } finally { clients.close(); }
});
test('HTTP non-admin cannot read/edit/results; user/admin sessions remain isolated; only server eligibility and phone assignment accepted', async () => {
  const dir = fs.mkdtempSync(path.join(root, 'returning-http-'));
  const salt = 'test-salt', password = 'test-only';
  const env = { DATA_FILE: path.join(dir, 'state.json'), ADMIN_EMAIL: 'test@example.com', ADMIN_PASSWORD_HASH: `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`, COOKIE_SECURE: 'false' };
  const backend = createBackend({ env });
  try {
    const user = await call(backend, '/api/user/login', { method: 'POST', headers: { 'x-dwira-native': '1' }, body: { name: 'Samira', phone: '0612345678' } });
    const auth = { 'x-user-token': user.body.token };
    for (const headers of [{}, auth]) {
      for (const route of ['/api/admin/returning', '/api/admin/returning/results']) assert.equal((await call(backend, route, { headers })).status, 401);
      assert.equal((await call(backend, '/api/admin/returning', { headers, method: 'PATCH', body: { versions: [version('X', 100)] } })).status, 401);
    }
    const login = await call(backend, '/api/admin/login', { method: 'POST', headers: { 'x-dwira-native': '1' }, body: { email: env.ADMIN_EMAIL, password } });
    const admin = { authorization: `Bearer ${login.body.token}` };
    assert.match(login.headers['set-cookie'], /^dwira_admin=.*HttpOnly; SameSite=Strict; Path=\/api; Max-Age=604800/);
    assert.equal((await call(backend, '/api/admin/returning', { method: 'PATCH', headers: admin, body: { versions: [version('A', 100)] } })).status, 200);
    assert.equal((await call(backend, '/api/user/returning', { headers: admin })).status, 401);
    assert.equal((await call(backend, '/api/user/returning', { headers: auth })).body.eligible, false);
    backend.clients.db.prepare('UPDATE clients SET free_used=1 WHERE id=?').run(user.body.user.id);
    assert.equal((await call(backend, '/api/user/returning', { headers: auth })).body.version.id, 'A');
    for (const kind of ['view', 'click', 'upgrade_confirmation']) {
      assert.equal((await call(backend, '/api/user/returning/event', { headers: auth, method: 'POST', body: { kind, versionId: 'wrong', phone: user.body.user.whatsapp } })).status, 400);
      assert.equal((await call(backend, '/api/user/returning/event', { headers: auth, method: 'POST', body: { kind, versionId: kind === 'upgrade_confirmation' ? null : 'A', phone: '+111111111' } })).status, 200);
    }
    const results = await call(backend, '/api/admin/returning/results', { headers: admin });
    assert.equal(results.body[0].purchases, 1);
    await call(backend, '/api/admin/logout', { method: 'POST', headers: admin, body: {} });
    assert.equal((await call(backend, '/api/user/session', { headers: auth })).status, 200);
    assert.equal((await call(backend, '/api/admin/returning', { headers: admin })).status, 401);
  } finally { backend.server.emit('close'); fs.rmSync(dir, { recursive: true, force: true }); }
});
