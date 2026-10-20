const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const crypto = require('node:crypto');
const { createBackend } = require('../server');
const { freshDb, closeShared } = require('./test-db');

const memory = { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false' };
function call(backend, url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', ...headers }, socket: { remoteAddress: 'test-client' } });
    const output = { headers: {} };
    const res = { headersSent: false, setHeader(key, value) { output.headers[key.toLowerCase()] = value; }, writeHead(status) { output.status = status; this.headersSent = true; }, end(value) { output.body = value ? JSON.parse(value) : undefined; resolve(output); } };
    backend.handle(req, res);
  });
}
const native = { 'x-dwira-native': '1' };
const demand = id => ({ id, photoUri: 'data:image/png;base64,aW1hZ2U=', draft: { toolId: 'tool_interior' } });

test('lead form flow: phone login -> free claim -> request, exactly as /lead + /render do it', async () => {
  const backend = createBackend({ env: { ...memory }, db: await freshDb() });
  try {
    // /lead : "amine" / "0626900460" (the values from the failing screenshot)
    const login = await call(backend, '/api/user/login', { method: 'POST', headers: native, body: { name: 'amine', phone: '0626900460' } });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.whatsapp, '+212626900460');
    assert.equal(login.body.user.freeUsed, 0);
    assert.equal(login.body.user.credits, 1);
    assert(login.headers['set-cookie'].startsWith('dwira_user='));
    const auth = { 'x-user-token': login.body.token };
    assert.equal((await call(backend, '/api/user/session', { headers: auth })).body.user.name, 'amine');
    // /render : no image-upload/spam step any more, just the request
    const headers = { ...auth, 'x-demand-token': 'a'.repeat(64) };
    const created = await call(backend, '/api/requests', { method: 'POST', headers, body: demand('claim-lead-0001') });
    assert.equal(created.status, 201);
    assert.equal(created.body.whatsapp, '+212626900460');
    assert.equal(created.body.clientHash, undefined, 'internal fields are never exposed');
    // lost response -> retry must be idempotent
    assert.equal((await call(backend, '/api/requests', { method: 'POST', headers, body: demand('claim-lead-0001') })).body.id, created.body.id);
    assert.equal((await call(backend, '/api/user/requests', { headers: auth })).body.length, 1);
    assert.equal((await call(backend, '/api/user/session', { headers: auth })).body.user.freeUsed, 1);
    // second free design needs Pro
    assert.equal((await call(backend, '/api/user/claim', { method: 'POST', headers: auth, body: { id: 'claim-second-0002' } })).body.error, 'PRO_REQUIRED');
  } finally { backend.server.emit('close'); }
});

test('invalid profiles are rejected and the same phone in any spelling restores the same account', async () => {
  const backend = createBackend({ env: { ...memory }, db: await freshDb() });
  try {
    for (const body of [{ name: 'a', phone: '0626900460' }, { name: 'amine', phone: '123' }, { name: 'amine', phone: 'abc' }, {}]) {
      assert.equal((await call(backend, '/api/user/login', { method: 'POST', body })).status, 400);
    }
    const ids = new Set();
    for (const phone of ['0626900460', '+212626900460', '00212626900460', '06 26 90 04 60']) ids.add((await call(backend, '/api/user/login', { method: 'POST', body: { name: 'amine', phone } })).body.user.id);
    assert.equal(ids.size, 1);
    // concurrent first logins for a new phone create exactly one profile
    const racing = await Promise.all([1, 2, 3, 4].map(() => call(backend, '/api/user/login', { method: 'POST', body: { name: 'racer', phone: '0611111111' } })));
    assert.equal(new Set(racing.map(row => row.body.user.id)).size, 1);
  } finally { backend.server.emit('close'); }
});

test('atomic racing claims, ownership isolation, history and credit grants', async () => {
  const backend = createBackend({ env: { ...memory }, db: await freshDb() });
  try {
    const first = await backend.clients.login('Client One', '+212600000001');
    const results = await Promise.allSettled([1, 2].map(n => backend.clients.claim(first.user, `racing-claim-${n}`)));
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 1, 'only one free claim can win');
    assert.equal((await backend.clients.user(first.user.id)).freeUsed, 1);
    await backend.clients.grant(first.user.id, 2);
    assert.equal((await backend.clients.claim(first.user, 'paid-claim-0001')).credits, 1);

    const admin = await call(backend, '/api/admin/login', { method: 'POST', headers: native, body: { email: 'admin', password: 'admin' } });
    const adminAuth = { authorization: `Bearer ${admin.body.token}` };
    const auth = { 'x-user-token': first.token };
    assert.equal((await call(backend, '/api/admin/clients', { headers: auth })).status, 401, 'a client is never an admin');
    assert.equal((await call(backend, '/api/user/session', { headers: adminAuth })).status, 401, 'an admin is not a client');
    assert.equal((await call(backend, '/api/admin/clients', { headers: adminAuth })).body.length, 1);

    const history = await call(backend, '/api/user/history', { method: 'POST', headers: auth, body: { claimId: 'paid-claim-0001', before: 'photo', status: 'pending', draft: { toolId: 'tool_interior' } } });
    assert.equal(history.status, 200);
    assert.equal((await call(backend, '/api/user/history', { method: 'POST', headers: auth, body: { claimId: 'not-claimed-0001', before: 'photo', status: 'pending', draft: { toolId: 't' } } })).status, 403);
    const other = await backend.clients.login('Client Two', '+212600000002');
    assert.equal((await call(backend, `/api/user/history/${history.body.id}`, { headers: { 'x-user-token': other.token } })).status, 404);
    await call(backend, '/api/user/logout', { method: 'POST', headers: auth, body: {} });
    assert.equal((await call(backend, '/api/user/session', { headers: auth })).status, 401);
  } finally { backend.server.emit('close'); }
});

test('admin delivery updates the client history; clients cannot self-deliver or read other requests', async () => {
  const backend = createBackend({ env: { ...memory }, db: await freshDb() });
  try {
    const login = await backend.clients.login('Test Person', '+212612345678');
    const auth = { 'x-user-token': login.token, 'x-demand-token': 'a'.repeat(64) };
    const created = await call(backend, '/api/requests', { method: 'POST', headers: auth, body: { ...demand('claim-http-00001'), name: 'Spoofed', whatsapp: '+11111111111' } });
    assert.equal(created.body.name, 'Test Person', 'identity comes from the session, not the body');
    const history = await call(backend, '/api/user/history', { method: 'POST', headers: auth, body: { claimId: 'claim-http-00001', before: 'photo', status: 'pending', draft: { toolId: 'tool_interior' } } });
    assert.equal((await call(backend, `/api/requests/${created.body.id}`, { method: 'PATCH', headers: auth, body: { historyId: history.body.id, status: 'delivered', name: 'x' } })).body.status, 'pending');
    const admin = await call(backend, '/api/admin/login', { method: 'POST', headers: native, body: { email: 'admin', password: 'admin' } });
    const adminAuth = { authorization: `Bearer ${admin.body.token}` };
    assert.equal((await call(backend, `/api/requests/${created.body.id}`, { method: 'PATCH', headers: adminAuth, body: { finalResult: 'https://example.com/final.jpg', status: 'delivered' } })).body.status, 'delivered');
    assert.equal((await call(backend, '/api/user/history', { headers: auth })).body[0].status, 'done');
    const other = await backend.clients.login('Other', '+212600000002');
    assert.equal((await call(backend, `/api/requests/${created.body.id}`, { headers: { 'x-user-token': other.token } })).status, 404);
    assert.equal((await call(backend, '/api/requests', { headers: { 'x-user-token': other.token } })).status, 401);
    assert.equal((await call(backend, '/api/requests', { headers: adminAuth })).body.length, 1);
    assert.equal((await call(backend, `/api/requests/${created.body.id}`, { method: 'DELETE', headers: adminAuth })).status, 200);
    assert.equal((await call(backend, '/api/requests', { headers: adminAuth })).body.length, 0);
  } finally { backend.server.emit('close'); }
});

test('health reports the database; same-origin works without an allowlist; default and custom admin login', async () => {
  const salt = 'test-salt', password = 'a-long-test-password';
  const env = { ...memory, ADMIN_EMAIL: 'owner@example.com', ADMIN_PASSWORD_HASH: `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}` };
  const backend = createBackend({ env, db: await freshDb() });
  try {
    const health = await call(backend, '/api/health', { headers: { origin: 'https://dwira.example', host: 'dwira.example' } });
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.database, 'pglite');
    assert.equal(health.headers['access-control-allow-origin'], 'https://dwira.example');
    assert.equal((await call(backend, '/api/health', { headers: { origin: 'https://evil.example', host: 'dwira.example' } })).status, 403);
    assert.equal((await call(backend, '/api/admin/clients', { headers: { origin: 'https://dwira.example', host: 'dwira.example' } })).status, 401);
    assert.equal((await call(backend, '/api/admin/login', { method: 'POST', body: { email: 'admin', password: 'admin' } })).status, 200);
    assert.equal((await call(backend, '/api/admin/login', { method: 'POST', body: { email: 'owner@example.com', password } })).status, 200);
    assert.equal((await call(backend, '/api/admin/login', { method: 'POST', body: { email: 'admin', password: 'nope' } })).status, 401);
    assert.equal((await call(backend, '/api/admin/spam', { headers: {} })).status, 404, 'the spam monitor no longer exists');
    assert.equal((await call(backend, '/api/admin/returning', { headers: {} })).status, 404, 'the returning-message API no longer exists');
  } finally { backend.server.emit('close'); }
});

test('on Vercel without a database the API answers a clear 503 JSON error instead of crashing', async () => {
  const backend = createBackend({ env: { VERCEL: '1' } });
  try {
    const health = await call(backend, '/api/health');
    assert.equal(health.status, 503);
    assert.equal(health.body.database, 'missing');
    const login = await call(backend, '/api/user/login', { method: 'POST', body: { name: 'amine', phone: '0626900460' } });
    assert.equal(login.status, 503);
    assert.equal(login.body.error, 'DATABASE_NOT_CONFIGURED');
  } finally { backend.server.emit('close'); }
});

test.after(closeShared);
