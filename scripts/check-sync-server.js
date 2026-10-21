const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { createBackend } = require('../server');
const { freshDb, closeShared } = require('./test-db');

const key = crypto.createECDH('prime256v1');
key.generateKeys();
const sub = id => ({ kind: 'web', language: 'fr', subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: { p256dh: key.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } } });
function call(backend, url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', ...headers }, socket: { remoteAddress: 'test-client' } });
    const output = { headers: {} };
    const res = { headersSent: false, setHeader: (k, v) => { output.headers[k.toLowerCase()] = v; }, writeHead(status) { output.status = status; this.headersSent = true; }, end(value) { output.body = value ? JSON.parse(value) : undefined; resolve(output); } };
    backend.handle(req, res);
  });
}
const native = { 'x-dwira-native': '1' };
async function setup() {
  const sent = [];
  const backend = createBackend({ env: { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', PUSH_WAIT_MS: '4000' }, db: await freshDb(), senders: { web: async (s, payload) => { sent.push({ endpoint: s.endpoint, ...JSON.parse(payload) }); } } });
  const login = await call(backend, '/api/admin/login', { method: 'POST', headers: native, body: { email: 'admin', password: 'admin' } });
  return { backend, sent, admin: { authorization: `Bearer ${login.body.token}` } };
}

test('real lead flow notifies the admin: new client account, then every render request (not only the test button)', async () => {
  const { backend, sent, admin } = await setup();
  try {
    assert.equal((await call(backend, '/api/push/subscriptions', { method: 'POST', headers: admin, body: sub('admin-phone') })).status, 200);
    // A visitor fills the lead form (login) -> admins are notified immediately.
    const login = await call(backend, '/api/user/login', { method: 'POST', headers: native, body: { name: 'Salma Real', phone: '0661000001' } });
    assert.equal(login.status, 200);
    const lead = sent.filter(p => p.title === 'Nouveau client');
    assert.equal(lead.length, 1);
    assert.equal(lead[0].body, 'Salma Real - +212661000001');
    // Logging in again with the same phone is not a new lead.
    await call(backend, '/api/user/login', { method: 'POST', headers: native, body: { name: 'Salma Real', phone: '0661000001' } });
    assert.equal(sent.filter(p => p.title === 'Nouveau client').length, 1);
    // First (free) render request.
    const auth = { 'x-user-token': login.body.token, 'x-demand-token': 'b'.repeat(64) };
    const demand = id => ({ id, photoUri: 'data:image/png;base64,aW1hZ2U=', draft: { toolId: 'tool_interior' } });
    assert.equal((await call(backend, '/api/requests', { method: 'POST', headers: auth, body: demand('real-claim-0001') })).status, 201);
    assert.equal(sent.filter(p => p.title === 'Nouvelle demande').length, 1);
    // A later request from a client with credits also notifies.
    await backend.clients.grant(login.body.user.id, 3);
    assert.equal((await call(backend, '/api/requests', { method: 'POST', headers: auth, body: demand('real-claim-0002') })).status, 201);
    assert.equal(sent.filter(p => p.title === 'Nouvelle demande').length, 2);
    assert.equal((await backend.db.query('SELECT * FROM outbox')).length, 0, 'nothing left in the queue');
  } finally { backend.server.emit('close'); }
});

test('notification preference lives in the database and is respected; failed pushes retry from the sync poll', async () => {
  const { backend, sent, admin } = await setup();
  try {
    await call(backend, '/api/push/subscriptions', { method: 'POST', headers: admin, body: sub('admin-pc') });
    assert.equal((await call(backend, '/api/prefs?as=admin', { method: 'PATCH', headers: admin, body: { notifications: false } })).body.notifications, false);
    assert.equal((await call(backend, '/api/admin/session', { headers: admin })).body.prefs.notifications, false, 'saved per admin in the database');
    const login = await call(backend, '/api/user/login', { method: 'POST', headers: native, body: { name: 'Quiet Lead', phone: '0661000002' } });
    assert.equal(login.status, 200);
    assert.equal(sent.length, 0, 'admin switched notifications off');
    await call(backend, '/api/prefs?as=admin', { method: 'PATCH', headers: admin, body: { notifications: true } });
    const loud = await call(backend, '/api/user/login', { method: 'POST', headers: native, body: { name: 'Loud Lead', phone: '0661000003' } });
    assert.equal(loud.status, 200);
    assert.equal(sent.filter(p => p.title === 'Nouveau client').length, 1);
    assert.equal((await call(backend, '/api/prefs?as=admin', { method: 'PATCH', body: { notifications: false } })).status, 401, 'anonymous cannot write admin prefs');
    assert.equal((await call(backend, '/api/prefs', { method: 'PATCH', headers: admin, body: { notifications: 'yes' } })).status, 401, 'admin session is not a client');
  } finally { backend.server.emit('close'); }
});

test('client devices get a "design ready" push when the admin delivers; per-client prefs and isolation', async () => {
  const { backend, sent, admin } = await setup();
  try {
    const a = await call(backend, '/api/user/login', { method: 'POST', headers: native, body: { name: 'Client A', phone: '0661000004' } });
    const b = await call(backend, '/api/user/login', { method: 'POST', headers: native, body: { name: 'Client B', phone: '0661000005' } });
    const authA = { 'x-user-token': a.body.token, 'x-demand-token': 'c'.repeat(64) }, authB = { 'x-user-token': b.body.token };
    assert.equal((await call(backend, '/api/push/subscriptions', { method: 'POST', headers: authA, body: { ...sub('a-phone'), owner: 'client' } })).status, 200);
    assert.equal((await call(backend, '/api/push/subscriptions', { method: 'POST', headers: authB, body: { ...sub('b-phone'), owner: 'client' } })).status, 200);
    assert.equal((await call(backend, '/api/push/subscriptions', { method: 'POST', headers: authA, body: sub('x') })).status, 401, 'a client cannot register as an admin device');
    const created = await call(backend, '/api/requests', { method: 'POST', headers: authA, body: { id: 'ready-claim-0001', photoUri: 'data:image/png;base64,aW1hZ2U=', draft: { toolId: 'tool_interior' } } });
    assert.equal(sent.length, 0, 'clients never receive admin notifications');
    await call(backend, `/api/requests/${created.body.id}`, { method: 'PATCH', headers: admin, body: { status: 'delivered', finalResult: 'https://example.com/final.jpg' } });
    const ready = sent.filter(p => p.title === 'Votre design est prêt');
    assert.equal(ready.length, 1);
    assert.equal(ready[0].endpoint, 'https://fcm.googleapis.com/fcm/send/a-phone', 'only the owner is notified');
    assert.equal(ready[0].url, '/history');
    // Re-saving a delivered request does not notify twice.
    await call(backend, `/api/requests/${created.body.id}`, { method: 'PATCH', headers: admin, body: { status: 'delivered' } });
    assert.equal(sent.filter(p => p.title === 'Votre design est prêt').length, 1);
    // Prefs per client.
    assert.equal((await call(backend, '/api/prefs', { method: 'PATCH', headers: authA, body: { notifications: false, lang: 'fr' } })).body.lang, 'fr');
    assert.equal((await call(backend, '/api/user/session', { headers: authB })).body.prefs.notifications, undefined, 'B is unaffected');
    assert.equal((await call(backend, '/api/prefs', { method: 'PATCH', headers: authA, body: { lang: 'xx' } })).status, 400);
  } finally { backend.server.emit('close'); }
});

test('content, settings and plans are stored in the database, seeded once, admin-only to write, and versioned for real-time sync', async () => {
  const { backend, admin } = await setup();
  try {
    const first = await call(backend, '/api/content');
    assert.equal(first.status, 200);
    assert(first.body.collections.tools.length >= 8 && first.body.collections.plans.length === 3);
    assert.equal(first.body.docs.settings.defaultFreeCredits, 1);
    assert.equal(first.body.collections.models.every(m => m.apiKey === ''), true);
    const v0 = (await call(backend, '/api/sync')).body.content;
    assert.equal((await call(backend, '/api/admin/content/tabs/tab_new', { method: 'PUT', body: { title: { dar: 'x', ar: 'x', fr: 'x' }, order: 9, visible: true } })).status, 401);
    assert.equal((await call(backend, '/api/admin/doc/settings', { method: 'PATCH', body: { homeShowAll: false } })).status, 401);
    const put = await call(backend, '/api/admin/content/tabs/tab_new', { method: 'PUT', headers: admin, body: { title: { dar: 'جديد', ar: 'جديد', fr: 'Nouveau' }, order: 9, visible: true } });
    assert.equal(put.body.id, 'tab_new');
    assert((await call(backend, '/api/sync')).body.content > v0, 'a content change bumps the version every device polls');
    assert.equal((await call(backend, '/api/content')).body.collections.tabs.some(t => t.id === 'tab_new'), true);
    await call(backend, '/api/admin/doc/settings', { method: 'PATCH', headers: admin, body: { userNavStyle: 'classic' } });
    const docs = (await call(backend, '/api/content')).body.docs.settings;
    assert.equal(docs.userNavStyle, 'classic');
    assert.equal(docs.defaultFreeCredits, 1, 'document patches merge');
    // Secrets: only the admin sees provider keys, and an update without a key keeps the stored one.
    await call(backend, '/api/admin/content/models/mdl_gemini', { method: 'PUT', headers: admin, body: { name: 'Gemini', provider: 'Google', modelName: 'g', apiKey: 'sk-secret-1234', enabled: true, isDefault: true, order: 0, visible: true } });
    assert.equal((await call(backend, '/api/content')).body.collections.models.find(m => m.id === 'mdl_gemini').apiKey, '', 'public never sees keys');
    assert.equal((await call(backend, '/api/content', { headers: admin })).body.collections.models.find(m => m.id === 'mdl_gemini').apiKey, 'sk-secret-1234');
    // Deleting is permanent: the starter content is never re-inserted.
    await call(backend, '/api/admin/content/tabs', { method: 'DELETE', headers: admin, body: { ids: ['tab_decor'] } });
    const backend2 = createBackend({ env: { PGLITE_DIR: ':memory:' }, db: backend.db });
    try { assert.equal((await call(backend2, '/api/content')).body.collections.tabs.some(t => t.id === 'tab_decor'), false); } finally { backend2.server.emit('close'); }
    assert.equal((await call(backend, '/api/admin/content/nope/x', { method: 'PUT', headers: admin, body: {} })).status, 404);
    assert.equal((await call(backend, '/api/admin/content/tabs/bad id!', { method: 'PUT', headers: admin, body: {} })).status, 404);
    assert.equal((await call(backend, '/api/admin/doc/nope', { method: 'PATCH', headers: admin, body: {} })).status, 404);
  } finally { backend.server.emit('close'); }
});

test('sync versions: client changes reach admin lists and the owner on every device; blocked state is exposed', async () => {
  const { backend, admin } = await setup();
  try {
    const login = await call(backend, '/api/user/login', { method: 'POST', headers: native, body: { name: 'Sync Person', phone: '0661000006' } });
    const auth = { 'x-user-token': login.body.token, 'x-demand-token': 'd'.repeat(64) };
    const poll = async headers => (await call(backend, '/api/sync', { headers })).body;
    const a0 = await poll(admin), c0 = await poll(auth);
    assert.equal(a0.isAdmin, true);
    assert.equal(c0.isAdmin, false);
    assert.equal(c0.requests, null, 'clients never see admin versions');
    const created = await call(backend, '/api/requests', { method: 'POST', headers: auth, body: { id: 'sync-claim-0001', photoUri: 'data:image/png;base64,aW1hZ2U=', draft: { toolId: 'tool_interior' } } });
    const a1 = await poll(admin), c1 = await poll(auth);
    assert(a1.requests > a0.requests && a1.clients > a0.clients, 'admin lists change');
    assert(c1.client > c0.client, "client's own data changes");
    await call(backend, `/api/admin/clients/${login.body.user.id}`, { method: 'PATCH', headers: admin, body: { credits: 5 } });
    const c2 = await poll(auth);
    assert(c2.client > c1.client, 'admin credit edit reaches the client device');
    assert.equal((await call(backend, '/api/user/session', { headers: auth })).body.user.credits, 5);
    await call(backend, `/api/admin/clients/${login.body.user.id}`, { method: 'PATCH', headers: admin, body: { blocked: true } });
    assert.equal((await call(backend, '/api/sync', { headers: auth })).status, 200);
    await call(backend, `/api/requests/${created.body.id}`, { method: 'DELETE', headers: admin });
    assert((await poll(admin)).requests > a1.requests);
    assert.equal((await call(backend, '/api/sync')).body.user, null, 'anonymous poll only reads content');
  } finally { backend.server.emit('close'); }
});

test.after(closeShared);
