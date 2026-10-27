const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { translate, clean, pieces } = require('../server/translate');

const llm = content => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }) });

test('clean validates the request', () => {
  assert.throws(() => clean({ from: 'en', texts: ['a'] }), /source/);
  assert.throws(() => clean({ from: 'fr', texts: [] }), /texts/);
  assert.throws(() => clean({ from: 'fr', texts: ['  '] }), /texts/);
  assert.throws(() => clean({ from: 'fr', texts: ['a'], to: ['fr'] }), /Nothing/);
  assert.deepEqual(clean({ from: 'fr', texts: [' Salon '] }), { from: 'fr', to: ['ar', 'dar'], texts: ['Salon'] });
});

test('pieces cuts long text for MyMemory', () => {
  const long = 'mot '.repeat(400);
  assert.ok(pieces(long).every(p => p.length <= 451));
});

test('the LLM answer fills every wanted language and is cached', async () => {
  let calls = 0;
  const fetch = async (...args) => { calls++; return llm({ ar: ['صالون عصري'], dar: ['صالون ديال دابا'] })(...args); };
  const first = await translate({ from: 'fr', texts: ['Salon moderne cache1'] }, { fetch });
  assert.deepEqual(first.translations, { ar: ['صالون عصري'], dar: ['صالون ديال دابا'] });
  assert.equal(first.provider.dar, 'pollinations');
  await translate({ from: 'fr', texts: ['Salon moderne cache1'] }, { fetch });
  assert.equal(calls, 1);
});

test('a wrong-script LLM answer is rejected and MyMemory takes over; Darija falls back to the Arabic text', async () => {
  const fetch = async (url, options) => {
    if (String(url).includes('pollinations')) return llm({ ar: ['Salon moderne'], dar: ['Salon moderne'] })();
    assert.match(String(url), /langpair=fr\|ar/);
    return { ok: true, json: async () => ({ responseData: { translatedText: 'صالون عصري' } }) };
  };
  const out = await translate({ from: 'fr', texts: ['Salon fallback2'] }, { fetch });
  assert.deepEqual(out.translations.ar, ['صالون عصري']);
  assert.deepEqual(out.translations.dar, ['صالون عصري']);
  assert.equal(out.provider.ar, 'mymemory');
});

test('Darija to Arabic is a plain copy when the LLM is down; total failure leaves languages out', async () => {
  const down = async () => { throw new Error('offline'); };
  const copy = await translate({ from: 'dar', texts: ['دار كبيرة'], to: ['ar'] }, { fetch: down });
  assert.deepEqual(copy.translations, { ar: ['دار كبيرة'] });
  assert.equal(copy.provider.ar, 'copy');
  const none = await translate({ from: 'fr', texts: ['Chambre totalfail3'] }, { fetch: down });
  assert.deepEqual(none.translations, {});
});

test('POST /api/admin/translate is admin only and uses the injected translator', async () => {
  const { createBackend } = require('../server');
  const { freshDb } = require('./test-db');
  const call = (backend, url, { method = 'GET', body, headers = {} } = {}) => new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', ...headers }, socket: { remoteAddress: 'test-client' } });
    const output = { headers: {} };
    const res = { headersSent: false, setHeader: (k, v) => { output.headers[k.toLowerCase()] = v; }, writeHead(status) { output.status = status; this.headersSent = true; }, end(value) { output.body = value ? JSON.parse(value) : undefined; resolve(output); } };
    backend.handle(req, res);
  });
  const seen = [];
  const backend = createBackend({ env: { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false' }, db: await freshDb(), translator: async input => { seen.push(input); return { translations: { ar: ['x'] }, provider: { ar: 'test' } }; } });
  try {
    const anon = await call(backend, '/api/admin/translate', { method: 'POST', body: { from: 'fr', texts: ['a'] } });
    assert.ok([401, 403].includes(anon.status));
    assert.equal(seen.length, 0);
    const login = await call(backend, '/api/admin/login', { method: 'POST', headers: { 'x-dwira-native': '1' }, body: { email: 'admin', password: 'admin' } });
    const ok = await call(backend, '/api/admin/translate', { method: 'POST', headers: { authorization: `Bearer ${login.body.token}` }, body: { from: 'fr', texts: ['a'] } });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.translations, { ar: ['x'] });
  } finally { backend.server.emit('close'); }
});
