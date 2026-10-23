const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createBackend } = require('../server');
const { freshDb, closeShared } = require('./test-db');

function call(backend, url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', ...headers }, socket: { remoteAddress: 'test-client' } });
    const output = { headers: {} };
    const res = { headersSent: false, setHeader: (k, v) => { output.headers[k.toLowerCase()] = v; }, writeHead(status, h) { output.status = status; Object.assign(output.headers, Object.fromEntries(Object.entries(h || {}).map(([k, v]) => [k.toLowerCase(), v]))); this.headersSent = true; }, end(value) { output.raw = value; try { output.body = value ? JSON.parse(value) : undefined; } catch { output.body = undefined; } resolve(output); } };
    backend.handle(req, res);
  });
}
const native = { 'x-dwira-native': '1' };
// A real PNG header followed by filler: large enough (> 4 KB) to be moved out of the content JSON.
const bigPng = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(9000, 7)]).toString('base64');
const smallPng = 'data:image/png;base64,iVBORw0KGgo=';

test('uploaded images are stored as cacheable media, keeping /api/content small', async () => {
  const backend = createBackend({ env: { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false' }, db: await freshDb() });
  try {
    const login = await call(backend, '/api/admin/login', { method: 'POST', headers: native, body: { email: 'admin', password: 'admin' } });
    const admin = { authorization: `Bearer ${login.body.token}` };
    const saved = await call(backend, '/api/admin/content/roomTypes/room_upload', { method: 'PUT', headers: admin, body: { title: { fr: 'x', ar: 'x', dar: 'x' }, image: bigPng, icon: smallPng, order: 99, visible: true } });
    assert.equal(saved.status, 200);
    assert.match(saved.body.image, /^\/api\/media\/[a-f0-9]{32}\.png$/);
    assert.equal(saved.body.icon, smallPng, 'tiny images stay inline');
    const content = await call(backend, '/api/content');
    assert.ok(!JSON.stringify(content.body).includes(bigPng.slice(0, 200)), 'no inline copy in the public JSON');
    const file = await call(backend, saved.body.image);
    assert.equal(file.status, 200);
    assert.equal(file.headers['content-type'], 'image/png');
    assert.match(file.headers['cache-control'], /immutable/);
    assert.equal(Buffer.from(file.raw).toString('base64'), bigPng.split(',')[1]);
    assert.equal((await call(backend, '/api/media/' + 'f'.repeat(32) + '.png')).status, 404);
    assert.equal((await call(backend, '/api/media/..%2F..%2Fetc%2Fpasswd')).status, 404);
    // Logo uploads (settings documents) too.
    const doc = await call(backend, '/api/admin/doc/branding', { method: 'PATCH', headers: admin, body: { logoUri: bigPng } });
    assert.match(doc.body.logoUri, /^\/api\/media\//);
  } finally { backend.server.emit('close'); }
});

test('rows saved before media storage existed are migrated once', async () => {
  const db = await freshDb();
  const first = createBackend({ env: { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false' }, db });
  try {
    await call(first, '/api/content');
    await db.query("DELETE FROM settings WHERE key='media_migrated'");
    await db.query("INSERT INTO content_items(coll,id,data,updated_at) VALUES('roomTypes','legacy',$1,0)", [JSON.stringify({ id: 'legacy', image: bigPng, order: 50, visible: true })]);
  } finally { first.server.emit('close'); }
  const second = createBackend({ env: { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false' }, db });
  try {
    const content = await call(second, '/api/content');
    const legacy = content.body.collections.roomTypes.find(r => r.id === 'legacy');
    assert.match(legacy.image, /^\/api\/media\/[a-f0-9]{32}\.png$/);
    assert.equal((await call(second, legacy.image)).status, 200);
  } finally { second.server.emit('close'); }
});

test.after(closeShared);
