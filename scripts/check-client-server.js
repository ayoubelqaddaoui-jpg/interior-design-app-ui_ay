const test = process.versions.bun ? require('bun:test').test : require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { createClients } = require('../server/clients');
const { createBackend } = require('../server');
const root = path.resolve('.pw');
fs.mkdirSync(root, { recursive: true });
const upload = (clients, user, { device = 'a'.repeat(64), ip = '10.1.1.1', image = 'image one' } = {}) => {
  const req = Readable.from([Buffer.from(image.slice(0, 3)), Buffer.from(image.slice(3))]);
  req.headers = { 'content-type': 'image/png' }; req.socket = { remoteAddress: ip };
  return clients.upload(req, user, device);
};
const profile = (clients, n) => clients.login(`Client ${n}`, `+21260000${String(n).padStart(4, '0')}`);
function call(backend, url, { method = 'GET', body, headers = {}, raw } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(raw ? [raw] : body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', ...headers }, socket: { remoteAddress: 'test-client' } });
    const output = { headers: {} };
    const res = { headersSent: false, setHeader(key, value) { output.headers[key.toLowerCase()] = value; }, writeHead(status) { output.status = status; this.headersSent = true; }, end(value) { output.body = value ? JSON.parse(value) : undefined; resolve(output); } };
    backend.server.emit('request', req, res);
  });
}

test('phone-only restore, persistent free entitlement, independent logout and stream hashes', async () => {
  const dir = fs.mkdtempSync(path.join(root, 'clients-'));
  const file = path.join(dir, 'clients.sqlite');
  let clients = createClients(file);
  try {
    const first = profile(clients, 1);
    assert.equal(first.user.credits, 1);
    const signal = await upload(clients, first.user);
    const claimed = clients.claim(first.user, 'claim-first-0001', signal.uploadId);
    assert.equal(claimed.freeUsed, 1);
    clients.putSpace(first.user, 'history', { before: 'original', after: 'result', status: 'done' }, 'history-1');
    clients.logout(first.token);
    assert.equal(clients.authenticate(first.token), null);
    clients.close(); clients = createClients(file);
    const restored = clients.login('New name is not an identity', '00212600000001');
    assert.equal(restored.user.id, first.user.id);
    assert.equal(restored.user.freeUsed, 1);
    assert.equal(clients.listSpace(restored.user, 'history')[0].after, 'result');
    assert.throws(() => clients.claim(restored.user, 'claim-second-0002', signal.uploadId), /PRO_REQUIRED/);
    assert.equal(clients.claim(restored.user, 'claim-first-0001', signal.uploadId).freeUsed, 1, 'lost response retry must not charge again');
    const other = profile(clients, 2);
    assert.equal(clients.listSpace(other.user, 'history').length, 0, 'device never restores another phone space');
    const row = clients.db.prepare('SELECT * FROM signals').get();
    assert.equal(row.image_hash, crypto.createHash('sha256').update('image one').digest('hex'));
    assert(!JSON.stringify(row).includes('image one'));
    const indexes = clients.db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(row => row.name);
    for (const key of ['clients_phone', 'signals_phone', 'signals_device_id', 'signals_image_hash', 'signals_ip']) assert(indexes.includes(key));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  } finally { clients.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const shared of ['device', 'image', 'ip']) test(`spam detects shared ${shared} only across different phones; block OFF/ON/OFF and normal user safety`, async () => {
  const clients = createClients(':memory:');
  try {
    const first = profile(clients, 1), second = profile(clients, 2), third = profile(clients, 3), normal = profile(clients, 4);
    const a = { device: 'a'.repeat(64), ip: '1.1.1.1', image: 'first' };
    const b = { device: 'b'.repeat(64), ip: '2.2.2.2', image: 'second', [shared]: a[shared] };
    clients.claim(first.user, 'claim-first-0001', (await upload(clients, first.user, a)).uploadId);
    assert.equal(clients.monitor(0, Date.now()).block, false);
    clients.claim(second.user, 'claim-second-0002', (await upload(clients, second.user, b)).uploadId);
    assert.equal(clients.monitor(0, Date.now()).flagged, 2);
    clients.setBlock(true);
    const thirdUpload = await upload(clients, third.user, b);
    assert.throws(() => clients.claim(third.user, 'claim-third-0003', thirdUpload.uploadId), /SPAM_BLOCKED/);
    assert.equal(clients.user(third.user.id).freeUsed, 0);
    clients.claim(normal.user, 'claim-normal-0004', (await upload(clients, normal.user, { device: 'd'.repeat(64), ip: '4.4.4.4', image: 'normal' })).uploadId);
    assert.equal(clients.user(normal.user.id).freeUsed, 1, 'unflagged users must not be blocked');
    clients.grant(first.user.id, 2);
    clients.claim(first.user, 'claim-paid-00001', (await upload(clients, first.user, a)).uploadId);
    assert.equal(clients.user(first.user.id).credits, 1, 'blocking must never block paid grants');
    clients.setBlock(false);
    clients.claim(third.user, 'claim-third-0003', thirdUpload.uploadId);
    const report = clients.monitor(0, Date.now());
    assert.equal(report.flagged, 3); assert.equal(report.total, 4); assert.equal(report.percentage, 75);
    assert.equal(clients.monitor(Date.now() + 1000, Date.now() + 2000).total, 0);
    assert(report.rows.some(row => row.accounts === 3 && row.freeUsed === 3));
  } finally { clients.close(); }
});

test('atomic duplicate/racing claims and bounded paginated monitor', async () => {
  const clients = createClients(':memory:');
  try {
    const first = profile(clients, 1), signal = await upload(clients, first.user);
    const results = await Promise.allSettled([1, 2].map(async n => clients.claim(first.user, `racing-claim-${n}`, signal.uploadId)));
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
    for (let n = 2; n <= 24; n++) {
      const client = profile(clients, n);
      clients.claim(client.user, `page-claim-${n}`, (await upload(clients, client.user)).uploadId);
    }
    const one = clients.monitor(0, Date.now(), 1), two = clients.monitor(0, Date.now(), 2);
    assert.equal(one.rows.length, 20); assert.equal(two.rows.length, 4);
    assert.equal(new Set([...one.rows, ...two.rows].map(row => row.phone)).size, 24);
  } finally { clients.close(); }
});

test('HTTP user/admin session isolation, backend ownership, request validation and admin delivery', async () => {
  const directory = fs.mkdtempSync(path.join(root, 'clients-http-'));
  const password = 'test-only', salt = 'test-salt';
  const env = { DATA_FILE: path.join(directory, 'state.json'), ADMIN_EMAIL: 'test@example.com', ADMIN_PASSWORD_HASH: `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`, COOKIE_SECURE: 'false' };
  const backend = createBackend({ env });
  try {
    const admin = await call(backend, '/api/admin/login', { method: 'POST', headers: { 'x-dwira-native': '1' }, body: { email: env.ADMIN_EMAIL, password } });
    const adminAuth = { authorization: `Bearer ${admin.body.token}` };
    const login = await call(backend, '/api/user/login', { method: 'POST', headers: { 'x-dwira-native': '1' }, body: { name: 'Test Person', phone: '+212612345678' } });
    const auth = { 'x-user-token': login.body.token };
    assert.equal(login.status, 200); assert(login.headers['set-cookie'].startsWith('dwira_user='));
    assert.equal((await call(backend, '/api/admin/spam', { headers: auth })).status, 401);
    assert.equal((await call(backend, '/api/user/session', { headers: adminAuth })).status, 401);
    assert.equal((await call(backend, '/api/admin/spam?from=bad', { headers: adminAuth })).status, 400);
    const signal = await call(backend, '/api/user/image', { method: 'POST', headers: { ...auth, 'content-type': 'image/png', 'x-device-id': 'a'.repeat(64) }, raw: Buffer.from('image') });
    assert.equal(signal.status, 201);
    const demand = { id: 'claim-http-00001', uploadId: signal.body.uploadId, name: 'Spoofed Name', whatsapp: '+11111111111', photoUri: 'data:image/png;base64,aW1hZ2U=', draft: { toolId: 'tool_interior' } };
    const requestAuth = { ...auth, 'x-demand-token': 'a'.repeat(64) };
    const created = await call(backend, '/api/requests', { method: 'POST', headers: requestAuth, body: demand });
    assert.equal(created.status, 201); assert.equal(created.body.name, 'Test Person');
    assert.equal(created.body.whatsapp, '+212612345678');
    assert.equal((await call(backend, '/api/requests', { method: 'POST', headers: requestAuth, body: demand })).body.id, created.body.id);
    const history = await call(backend, '/api/user/history', { method: 'POST', headers: auth, body: { claimId: demand.id, before: demand.photoUri, status: 'pending', draft: demand.draft } });
    assert.equal(history.status, 200);
    await call(backend, `/api/requests/${created.body.id}`, { method: 'PATCH', headers: auth, body: { historyId: history.body.id } });
    await call(backend, `/api/requests/${created.body.id}`, { method: 'PATCH', headers: adminAuth, body: { finalResult: 'https://example.com/final.jpg', status: 'delivered' } });
    assert.equal((await call(backend, '/api/user/history', { headers: auth })).body[0].status, 'done');
    const other = await call(backend, '/api/user/login', { method: 'POST', headers: { 'x-dwira-native': '1' }, body: { name: 'Other Person', phone: '+212600000002' } });
    assert.equal((await call(backend, `/api/requests/${created.body.id}`, { headers: { 'x-user-token': other.body.token, 'x-demand-token': 'a'.repeat(64) } })).status, 404, 'device is not authorization');
    assert.equal((await call(backend, `/api/user/history/${history.body.id}`, { headers: { 'x-user-token': other.body.token } })).status, 404);
    await call(backend, '/api/user/logout', { method: 'POST', headers: { ...auth, ...adminAuth }, body: {} });
    assert.equal((await call(backend, '/api/user/session', { headers: auth })).status, 401);
    assert.equal((await call(backend, '/api/admin/session', { headers: adminAuth })).status, 200);
    await call(backend, '/api/admin/logout', { method: 'POST', headers: { ...adminAuth, 'x-user-token': other.body.token }, body: {} });
    assert.equal((await call(backend, '/api/user/session', { headers: { 'x-user-token': other.body.token } })).status, 200);
    const restored = await call(backend, '/api/user/login', { method: 'POST', body: { name: 'Test Person', phone: '00212612345678' } });
    assert.equal(restored.body.user.id, login.body.user.id); assert.equal(restored.body.user.freeUsed, 1);
  } finally { backend.server.emit('close'); fs.rmSync(directory, { recursive: true, force: true }); }
});


test('health identifies the live runtime; same-origin deployments work without an origin allowlist', async () => {
  const directory = fs.mkdtempSync(path.join(root, 'health-http-'));
  const backend = createBackend({ env: { DATA_FILE: path.join(directory, 'state.json'), COOKIE_SECURE: 'false' } });
  try {
    const health = await call(backend, '/api/health', { headers: { origin: 'https://dwira.example', host: 'dwira.example' } });
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.runtime, process.versions.bun ? 'bun' : 'node');
    assert.equal(health.body.adminConfigured, false);
    assert.equal(health.headers['access-control-allow-origin'], 'https://dwira.example');
    assert.equal((await call(backend, '/api/health', { headers: { origin: 'https://evil.example', host: 'dwira.example' } })).status, 403);
    assert.equal((await call(backend, '/api/admin/spam', { headers: { origin: 'https://dwira.example', host: 'dwira.example' } })).status, 401, 'same origin does not bypass admin authentication');
    const fallback = await call(backend, '/api/admin/login', { method: 'POST', headers: { 'x-dwira-native': '1' }, body: { email: 'admin', password: 'admin' } });
    assert.equal(fallback.status, 200, 'default admin/admin login works without server config');
    assert.equal((await call(backend, '/api/admin/login', { method: 'POST', body: { email: 'admin', password: 'wrong' } })).status, 401);
  } finally { backend.server.emit('close'); fs.rmSync(directory, { recursive: true, force: true }); }
});
