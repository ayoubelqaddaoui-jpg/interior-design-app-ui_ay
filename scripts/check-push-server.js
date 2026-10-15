const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const vm = require('node:vm');
const webpush = require('../server/node_modules/web-push');
const { createStore } = require('../server/store');
const { createBackend } = require('../server');
const { payloadFor, validateSubscription } = require('../server/notifications');
const key = crypto.createECDH('prime256v1');
key.generateKeys();
const subscription = id => ({ kind: 'web', language: 'fr', subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: { p256dh: key.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } } });
function call(backend, url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', ...headers }, socket: { remoteAddress: 'test-client' } });
    const output = { headers: {} };
    const res = { headersSent: false, setHeader: (key, value) => { output.headers[key.toLowerCase()] = value; }, writeHead(status, headers) { output.status = status; this.headersSent = true; Object.assign(output.headers, headers); }, end(value) { output.body = value ? JSON.parse(value) : undefined; resolve(output); } };
    backend.server.emit('request', req, res);
  });
}

test('durable save, real web-push encryption, isolated failures/410 cleanup, auth, retry idempotency and FCM', async () => {
  const directory = await fs.mkdtemp(path.resolve('.pw/push-server-'));
  const file = path.join(directory, 'state.json');
  const store = createStore(file);
  const vapid = webpush.generateVAPIDKeys();
  const salt = 'test-salt', password = 'local-test-password-only';
  const env = { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'mailto:testing@example.com', ADMIN_EMAIL: 'test@example.com', ADMIN_PASSWORD_HASH: `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`, DATA_FILE: file, COOKIE_SECURE: 'false', FCM_SERVICE_ACCOUNT_JSON: '{}' };
  const sent = [], fcm = [];
  let failure = false;
  const backend = createBackend({ env, store, senders: {
    web: async (sub, payload, options) => {
      if (sub.endpoint.endsWith('/expired')) throw Object.assign(new Error('expired'), { statusCode: 410 });
      if (failure && sub.endpoint.endsWith('/temporary')) throw Object.assign(new Error('temporary'), { statusCode: 503 });
      const request = webpush.generateRequestDetails(sub, payload, { ...options, vapidDetails: { subject: env.VAPID_SUBJECT, publicKey: vapid.publicKey, privateKey: vapid.privateKey } });
      assert(request.body instanceof Buffer && request.body.length > payload.length, 'Payload was not encrypted');
      assert.match(request.headers.Authorization, /vapid/i);
      sent.push(JSON.parse(payload));
    },
    fcm: async (token, payload) => fcm.push({ token, payload }),
  } });
  try {
    const config = await call(backend, '/api/push/config');
    assert.equal(config.body.publicKey, vapid.publicKey);
    assert(!JSON.stringify(config).includes(vapid.privateKey));
    assert.equal((await call(backend, '/api/requests')).status, 401);
    assert.equal((await call(backend, '/api/push/subscriptions', { method: 'POST', body: subscription('unauthorized') })).status, 401);
    const login = await call(backend, '/api/admin/login', { method: 'POST', body: { email: env.ADMIN_EMAIL, password }, headers: { 'x-dwira-native': '1' } });
    assert.equal(login.status, 200);
    const auth = { authorization: `Bearer ${login.body.token}` };
    for (const id of ['success', 'expired', 'temporary']) assert.equal((await call(backend, '/api/push/subscriptions', { method: 'POST', headers: auth, body: subscription(id) })).status, 200);
    const arabic = { ...subscription('arabic'), language: 'ar' };
    await call(backend, '/api/push/subscriptions', { method: 'POST', headers: auth, body: arabic });
    await call(backend, '/api/push/subscriptions', { method: 'POST', headers: auth, body: { kind: 'fcm', token: 'android-test-token-1234567890', language: 'ar' } });
    assert.equal((await store.read()).subscriptions.length, 5);
    assert.equal((await call(backend, '/api/push/subscriptions', { method: 'POST', headers: auth, body: { ...subscription('bad'), subscription: { endpoint: 'https://127.0.0.1/private', keys: arabic.subscription.keys } } })).status, 400);
    const demand = { id: 'stable-demand-1234', name: '  Test Client  ', whatsapp: ' +212 612345678 ', photoUri: 'data:image/png;base64,dGVzdA==', draft: { toolId: 'tool_interior' } };
    const user = backend.clients.login(demand.name.trim(), demand.whatsapp);
    const uploadReq = Readable.from([Buffer.from('test')]);
    uploadReq.headers = { 'content-type': 'image/png' }; uploadReq.socket = { remoteAddress: 'test-client' };
    demand.uploadId = (await backend.clients.upload(uploadReq, user.user, 'a'.repeat(64))).uploadId;
    const client = { 'x-demand-token': 'a'.repeat(64), 'x-user-token': user.token };
    failure = true;
    const created = await call(backend, '/api/requests', { method: 'POST', headers: client, body: demand });
    assert.equal(created.status, 201);
    assert.equal(created.body.name, 'Test Client');
    assert.equal(created.body.whatsapp, '+212612345678');
    const saved = await fs.readFile(file, 'utf8');
    assert(saved.includes(created.body.id), 'Demand was not durable before send');
    await backend.pump();
    // setImmediate may already own the pump; wait until its retry bookkeeping is complete.
    for (let i = 0; i < 50 && !(await store.read()).outbox[0]?.attempts; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal((await store.read()).requests.length, 1, 'Failed push blocked saving');
    assert.equal((await store.read()).subscriptions.length, 4, '410 was not removed');
    assert(sent.some(payload => payload.title === 'Nouvelle demande' && payload.body === 'Test Client - +212612345678'));
    assert(sent.some(payload => payload.title === 'طلب جديد' && payload.dir === 'rtl'));
    assert.equal(fcm[0].payload.body, 'Test Client - +212612345678');
    assert.equal((await call(backend, '/api/requests', { method: 'POST', headers: client, body: demand })).body.id, created.body.id);
    assert.equal((await store.read()).requests.length, 1, 'Retry created a duplicate');
    assert.equal((await call(backend, `/api/requests/${created.body.id}`, { headers: { 'x-demand-token': 'b'.repeat(64) } })).status, 404);
    assert.equal((await call(backend, `/api/requests/${created.body.id}`, { method: 'PATCH', headers: client, body: { name: 'Attacker', status: 'delivered' } })).body.name, 'Test Client');
    assert.equal((await call(backend, `/api/requests/${created.body.id}`, { method: 'PATCH', headers: auth, body: { status: 'processing' } })).body.status, 'processing');
    failure = false;
    const delivered = sent.length;
    await store.mutate(data => { data.outbox[0].nextAt = 0; });
    await backend.pump();
    assert.equal(sent.length, delivered + 1, 'Retry resent successful subscriptions');
    assert.equal((await store.read()).outbox.length, 0);
    const persisted = await createStore(file).read();
    assert.equal(persisted.requests.length, 1);
    assert.equal(persisted.subscriptions.length, 4);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    const denied = await call(backend, '/api/admin/session', { headers: { ...auth, origin: 'https://evil.example' } });
    assert.equal(denied.status, 403);
    const logout = await call(backend, '/api/admin/logout', { method: 'POST', headers: auth, body: {} });
    assert.equal(logout.status, 200);
    assert.equal((await call(backend, '/api/requests', { headers: auth })).status, 401);
  } finally { backend.server.emit('close'); await fs.rm(directory, { recursive: true, force: true }); }
});

test('bounded, multilingual payloads and safe push provider validation', () => {
  for (const language of ['en', 'fr', 'ar', 'dar']) {
    const payload = payloadFor({ id: 'abc', name: '  ' + '😀'.repeat(150) + '\n ', whatsapp: ' +212612345678 ' }, language);
    assert.equal(Array.from(payload.body.split(' - ')[0]).length, 80);
    assert.equal(payload.phone, '+212612345678');
    assert(payload.url.startsWith('/admin/requests?'));
    assert.equal(payload.actions.length, 2);
    assert(Buffer.byteLength(JSON.stringify(payload)) < 4096);
    assert.equal(payload.dir, language === 'ar' || language === 'dar' ? 'rtl' : 'ltr');
  }
  assert.equal(payloadFor({ id: 'abc', name: 'Name', whatsapp: '123456' }, 'en').title, 'New demand');
  assert.throws(() => validateSubscription({ ...subscription('ssrf'), subscription: { endpoint: 'http://fcm.googleapis.com/foo', keys: {} } }));
});

test('worker renders name/phone, Open, Call and safe fallbacks without an open app', async () => {
  const handlers = {}, displayed = [], opened = [], messages = [];
  const self = { location: { origin: 'https://dwira.example' }, addEventListener: (name, callback) => { handlers[name] = callback; }, skipWaiting: async () => {},
    registration: { showNotification: async (title, options) => displayed.push({ title, ...options }) },
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async url => { opened.push(url); return {}; } },
  };
  vm.runInNewContext(await fs.readFile('public/push-sw.js', 'utf8'), { self, URL });
  const payload = payloadFor({ id: 'test-123', name: 'Test Client', whatsapp: '+212612345678' }, 'fr');
  let pending;
  handlers.push({ data: { json: () => payload }, waitUntil: value => { pending = value; } }); await pending;
  assert.equal(displayed[0].body, 'Test Client - +212612345678');
  assert.equal(displayed[0].actions[0].title, 'Ouvrir');
  const event = action => ({ action, notification: { data: displayed[0].data, close() {} }, waitUntil: value => { pending = value; } });
  handlers.notificationclick(event('open')); await pending;
  assert(opened[0].includes('/admin/requests?target=test-123'));
  handlers.notificationclick(event('call')); await pending;
  assert.equal(opened[1], 'tel:+212612345678');
  self.clients.openWindow = async url => { if (url.startsWith('tel:')) throw new Error('Protocol blocked'); opened.push(url); return {}; };
  handlers.notificationclick(event('call')); await pending;
  assert(opened.at(-1).includes('call=%2B212612345678'));
  self.clients.matchAll = async () => [{ url: 'https://dwira.example/admin/interface', focus: async () => {}, postMessage: message => messages.push(message) }];
  handlers.notificationclick(event('open')); await pending;
  assert.equal(messages[0].type, 'dwira:notification-open');
  handlers.push({ data: { json: () => ({ ...payload, url: 'https://evil.example', phone: 'tel:javascript:alert(1)' }) }, waitUntil: value => { pending = value; } }); await pending;
  assert.equal(displayed.at(-1).data.url, 'https://dwira.example/admin/requests');
});
