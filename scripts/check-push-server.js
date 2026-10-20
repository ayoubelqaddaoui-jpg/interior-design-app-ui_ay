const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const vm = require('node:vm');
const webpush = require('web-push');
const { createBackend } = require('../server');
const { freshDb, closeShared } = require('./test-db');
const { createFcm, payloadFor, validateSubscription } = require('../server/notifications');
const key = crypto.createECDH('prime256v1');
key.generateKeys();
const subscription = id => ({ kind: 'web', language: 'fr', subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: { p256dh: key.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } } });
function call(backend, url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', ...headers }, socket: { remoteAddress: 'test-client' } });
    const output = { headers: {} };
    const res = { headersSent: false, setHeader: (k, v) => { output.headers[k.toLowerCase()] = v; }, writeHead(status) { output.status = status; this.headersSent = true; }, end(value) { output.body = value ? JSON.parse(value) : undefined; resolve(output); } };
    backend.handle(req, res);
  });
}

test('zero-config VAPID, real encryption, isolated failures, 410 cleanup, retry idempotency, test button and FCM', async () => {
  const env = { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', FCM_SERVICE_ACCOUNT_JSON: '{}' };
  const sent = [], fcm = [];
  let failure = false, publicKey;
  const backend = createBackend({ env, db: await freshDb(), senders: {
    web: async (sub, payload, options) => {
      if (sub.endpoint.endsWith('/expired')) throw Object.assign(new Error('expired'), { statusCode: 410 });
      if (failure && sub.endpoint.endsWith('/temporary')) throw Object.assign(new Error('temporary'), { statusCode: 503 });
      const keys = await backend.notifier.config();
      const request = webpush.generateRequestDetails(sub, payload, { ...options, vapidDetails: { subject: 'mailto:admin@example.com', publicKey: keys.publicKey, privateKey: JSON.parse((await backend.db.query("SELECT value FROM settings WHERE key='vapid'"))[0].value).privateKey } });
      assert(request.body instanceof Buffer && request.body.length > payload.length, 'Payload was not encrypted');
      assert.match(request.headers.Authorization, /vapid/i);
      sent.push(JSON.parse(payload));
    },
    fcm: async (token, payload) => fcm.push({ token, payload }),
  } });
  try {
    // No VAPID env at all: the key pair is generated once and stored, so the button works out of the box.
    const config = await call(backend, '/api/push/config');
    assert.equal(config.status, 200);
    publicKey = config.body.publicKey;
    assert.match(publicKey, /^[A-Za-z0-9_-]{80,}$/);
    assert.equal((await call(backend, '/api/push/config')).body.publicKey, publicKey, 'key is stable across calls');
    assert(!JSON.stringify(config.body).includes((await backend.db.query("SELECT value FROM settings WHERE key='vapid'"))[0].value.match(/privateKey":"([^"]+)/)[1]), 'private key never leaves the server');
    assert.equal((await call(backend, '/api/requests')).status, 401);
    assert.equal((await call(backend, '/api/push/subscriptions', { method: 'POST', body: subscription('unauthorized') })).status, 401);
    assert.equal((await call(backend, '/api/push/test', { method: 'POST', body: {} })).status, 401);

    const login = await call(backend, '/api/admin/login', { method: 'POST', body: { email: 'admin', password: 'admin' }, headers: { 'x-dwira-native': '1' } });
    const auth = { authorization: `Bearer ${login.body.token}` };
    assert.equal((await call(backend, '/api/push/test', { method: 'POST', headers: auth, body: {} })).body.error, 'NO_SUBSCRIPTION');
    for (const id of ['success', 'expired', 'temporary']) assert.equal((await call(backend, '/api/push/subscriptions', { method: 'POST', headers: auth, body: subscription(id) })).status, 200);
    const arabic = { ...subscription('arabic'), language: 'ar' };
    await call(backend, '/api/push/subscriptions', { method: 'POST', headers: auth, body: arabic });
    await call(backend, '/api/push/subscriptions', { method: 'POST', headers: auth, body: { kind: 'fcm', token: 'android-test-token-1234567890', language: 'ar' } });
    assert.equal(await backend.notifier.count(), 5);
    assert.equal((await call(backend, '/api/push/subscriptions', { method: 'POST', headers: auth, body: { ...subscription('bad'), subscription: { endpoint: 'https://127.0.0.1/private', keys: arabic.subscription.keys } } })).status, 400);
    assert.equal((await call(backend, '/api/push/subscriptions', { method: 'POST', headers: auth, body: { ...subscription('x'), subscription: { endpoint: 'https://web.push.apple.com/abc', keys: arabic.subscription.keys } } })).status, 200, 'Safari / iPhone endpoints are accepted');
    await call(backend, '/api/push/subscriptions', { method: 'DELETE', headers: auth, body: { ...subscription('x'), subscription: { endpoint: 'https://web.push.apple.com/abc', keys: arabic.subscription.keys } } });

    // A new demand notifies every device before the response returns (serverless functions freeze afterwards).
    const client = await backend.clients.login('  Test Client  ', ' +212 612345678 ');
    failure = true;
    const demand = { id: 'stable-demand-1234', photoUri: 'data:image/png;base64,dGVzdA==', draft: { toolId: 'tool_interior' } };
    const headers = { 'x-demand-token': 'a'.repeat(64), 'x-user-token': client.token };
    const created = await call(backend, '/api/requests', { method: 'POST', headers, body: demand });
    assert.equal(created.status, 201);
    assert.equal(created.body.name, 'Test Client');
    assert.equal(created.body.whatsapp, '+212612345678');
    assert.equal((await backend.db.query('SELECT id FROM requests')).length, 1, 'a failed push never blocks saving');
    assert.equal(await backend.notifier.count(), 4, '410 subscription removed');
    assert(sent.some(p => p.title === 'Nouvelle demande' && p.body === 'Test Client - +212612345678'));
    assert(sent.some(p => p.title === 'طلب جديد' && p.dir === 'rtl'));
    assert.equal(fcm[0].payload.body, 'Test Client - +212612345678');
    const queued = (await backend.db.query('SELECT * FROM outbox'))[0];
    assert.equal(queued.attempts, 1, 'the temporarily failing device is queued for retry');
    // retry from a lost response must not duplicate the demand or the notification
    const before = sent.length;
    assert.equal((await call(backend, '/api/requests', { method: 'POST', headers, body: demand })).body.id, created.body.id);
    assert.equal((await backend.db.query('SELECT id FROM requests')).length, 1);
    assert.equal(sent.length, before);
    // retry delivers only to devices that have not been served yet
    failure = false;
    await backend.db.query('UPDATE outbox SET next_at=0');
    const delivered = sent.length;
    assert.equal((await call(backend, '/api/push/pump', { headers: auth })).status, 200);
    assert.equal(sent.length, delivered + 1, 'retry resent successful subscriptions');
    assert.equal((await backend.db.query('SELECT * FROM outbox')).length, 0);
    // the "send a test" button reaches all registered devices
    const test = await call(backend, '/api/push/test', { method: 'POST', headers: auth, body: {} });
    assert.equal(test.body.ok, true);
    assert.equal(test.body.devices, 4);
    // cron endpoint: bearer secret or admin only
    assert.equal((await call(backend, '/api/push/pump')).status, 401);
    const cron = createBackend({ env: { ...env, CRON_SECRET: 'cron-secret-value' }, db: backend.db });
    try { assert.equal((await call(cron, '/api/push/pump', { headers: { authorization: 'Bearer cron-secret-value' } })).status, 200); } finally { cron.server.emit('close'); }
    assert.equal((await call(backend, '/api/admin/logout', { method: 'POST', headers: auth, body: {} })).status, 200);
    assert.equal((await call(backend, '/api/requests', { headers: auth })).status, 401);
  } finally { backend.server.emit('close'); }
});

test('FCM HTTP v1 sender: OAuth JWT exchange, message shape and dead-token mapping', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = JSON.stringify({ project_id: 'demo-project', client_email: 'sa@demo-project.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const calls = [];
  let dead = false;
  const send = createFcm(account, async (url, options) => {
    calls.push({ url, options });
    if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'token-1', expires_in: 3600 }), { status: 200 });
    if (dead) return new Response(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }), { status: 404 });
    return new Response('{}', { status: 200 });
  });
  await send('device-token-1234567890', payloadFor({ id: 'r1', name: 'Amine', whatsapp: '0626900460' }, 'fr'));
  await send('device-token-1234567890', payloadFor({ id: 'r2', name: 'Amine', whatsapp: '0626900460' }, 'fr'));
  assert.equal(calls.filter(c => c.url.includes('oauth2')).length, 1, 'access token is cached');
  const message = JSON.parse(calls[1].options.body).message;
  assert.equal(calls[1].url, 'https://fcm.googleapis.com/v1/projects/demo-project/messages:send');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer token-1');
  assert.equal(message.token, 'device-token-1234567890');
  assert.equal(message.notification.title, 'Nouvelle demande');
  assert.equal(message.android.notification.channel_id, 'demands');
  const jwt = new URLSearchParams(calls[0].options.body.toString()).get('assertion').split('.');
  assert(crypto.createVerify('RSA-SHA256').update(jwt.slice(0, 2).join('.')).verify(privateKey, jwt[2], 'base64url'), 'JWT is signed with the service-account key');
  dead = true;
  await assert.rejects(send('device-token-1234567890', payloadFor({ id: 'r3', name: 'A', whatsapp: '1' }, 'fr')), error => error.code === 'messaging/registration-token-not-registered');
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

test.after(closeShared);
