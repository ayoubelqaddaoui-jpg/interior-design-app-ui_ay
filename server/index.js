const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createStore } = require('./store');
const { createNotifier, validateSubscription, trim, phone } = require('./notifications');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
function passwordMatches(password, encoded) {
  const [salt, digest] = String(encoded || '').split(':');
  if (!salt || !digest || !/^[a-f0-9]{128}$/.test(digest)) return false;
  return crypto.timingSafeEqual(crypto.scryptSync(String(password), salt, 64), Buffer.from(digest, 'hex'));
}
async function readBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail(415, 'JSON required');
  let size = 0, chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw fail(413, 'Request too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw fail(400, 'Invalid JSON'); }
}
function validateDemand(value) {
  const name = trim(value?.name, 120), whatsapp = phone(value?.whatsapp);
  if (name.length < 2 || !/^\+?\d{6,20}$/.test(whatsapp)) throw fail(400, 'Name and phone required');
  if (typeof value.photoUri !== 'string' || value.photoUri.length > 1500000 || !/^(data:image\/(png|jpeg|webp);base64,|https?:\/\/)/.test(value.photoUri)) throw fail(400, 'Invalid photo');
  const draft = {};
  for (const key of ['toolId', 'roomTypeId', 'styleId', 'paletteId', 'modelId', 'mode']) {
    if (value.draft?.[key] != null) {
      if (typeof value.draft[key] !== 'string' || value.draft[key].length > 100) throw fail(400, 'Invalid draft');
      draft[key] = value.draft[key];
    }
  }
  if (!draft.toolId) throw fail(400, 'Tool required');
  return { name, whatsapp, draft, photoUri: value.photoUri, userId: trim(value.userId || 'client', 100), status: 'pending', createdAt: Date.now() };
}
function createBackend({ env = process.env, store = createStore(path.resolve(env.DATA_FILE || path.join(__dirname, 'data', 'state.json'))), senders } = {}) {
  const notifier = createNotifier(store, env, senders);
  const allowedOrigins = String(env.APP_ORIGINS || 'http://localhost:4173,http://localhost:8080').split(',').map(value => value.trim());
  const buckets = new Map();
  let pumping = false;
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      const jobs = (await store.read()).outbox.filter(job => job.nextAt <= Date.now());
      for (const job of jobs) {
        const state = await store.read();
        const demand = state.requests.find(row => row.id === job.requestId);
        if (!demand) { await store.mutate(data => { data.outbox = data.outbox.filter(row => row.requestId !== job.requestId); }); continue; }
        // Only notifications are inside this try/catch. The demand was already durably committed.
        try {
          const result = await notifier.deliver(demand, job.completed);
          await store.mutate(data => {
            const current = data.outbox.find(row => row.requestId === job.requestId);
            if (!current) return;
            if (!result.retry || current.attempts >= 6) data.outbox = data.outbox.filter(row => row !== current);
            else { current.completed = result.completed; current.attempts++; current.nextAt = Date.now() + Math.min(3600000, 30000 * 2 ** current.attempts); }
          });
        } catch { console.warn('Demand notification job deferred'); }
      }
    } catch { console.warn('Notification queue temporarily unavailable'); }
    finally { pumping = false; }
  }
  const timer = setInterval(pump, 15000);
  timer.unref();
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        if (origin && !allowedOrigins.includes(origin)) throw fail(403, 'Origin not allowed');
        if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Vary', 'Origin'); }
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Demand-Token, X-Dwira-Native');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
        if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
        // Memory-bound rate limits; do not trust spoofable X-Forwarded-For headers.
        const key = `${req.socket.remoteAddress}:${url.pathname === '/api/admin/login' ? 'login' : 'api'}`;
        const now = Date.now();
        if (buckets.size > 10000) for (const [id, bucket] of buckets) if (bucket.until < now) buckets.delete(id);
        const bucket = buckets.get(key) || { count: 0, until: now + 15 * 60000 };
        if (bucket.until < now) { bucket.count = 0; bucket.until = now + 15 * 60000; }
        bucket.count++; buckets.set(key, bucket);
        if (bucket.count > (url.pathname === '/api/admin/login' ? 20 : 300)) throw fail(429, 'Too many requests');
        const rawCookie = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('dwira_admin='))?.slice(12);
        const sessionToken = req.headers.authorization?.replace(/^Bearer /, '') || rawCookie;
        const session = sessionToken && (await store.read()).sessions.find(row => row.tokenHash === hash(sessionToken) && row.expiresAt > now);
        const admin = () => { if (!session) throw fail(401, 'Admin login required'); };
        const clientToken = req.headers['x-demand-token'];
        const clientHash = typeof clientToken === 'string' && /^[a-f0-9]{64}$/.test(clientToken) ? hash(clientToken) : null;
        const publicRow = ({ clientHash: ignored, clientRequestId: ignored2, ...row }) => row;
        if (req.method === 'GET' && url.pathname === '/api/push/config') return json(200, notifier.publicConfig);
        if (req.method === 'POST' && url.pathname === '/api/admin/login') {
          const body = await readBody(req);
          if (typeof body.email !== 'string' || typeof body.password !== 'string' || body.password.length > 512 || !env.ADMIN_EMAIL || body.email.trim().toLowerCase() !== env.ADMIN_EMAIL.toLowerCase() || !passwordMatches(body.password, env.ADMIN_PASSWORD_HASH)) throw fail(401, 'Invalid credentials');
          const token = crypto.randomBytes(32).toString('hex');
          await store.mutate(data => { data.sessions = data.sessions.filter(row => row.expiresAt > now); data.sessions.push({ tokenHash: hash(token), expiresAt: now + 7 * 86400000 }); });
          res.setHeader('Set-Cookie', `dwira_admin=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=604800${env.COOKIE_SECURE === 'false' ? '' : '; Secure'}`);
          return json(200, { ok: true, user: { id: 'usr_admin', name: 'Admin' }, ...(req.headers['x-dwira-native'] === '1' ? { token } : {}) });
        }
        if (req.method === 'GET' && url.pathname === '/api/admin/session') { admin(); return json(200, { ok: true }); }
        if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
          if (session) await store.mutate(data => { data.sessions = data.sessions.filter(row => row.tokenHash !== session.tokenHash); });
          res.setHeader('Set-Cookie', 'dwira_admin=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0');
          return json(200, { ok: true });
        }
        if (url.pathname === '/api/push/subscriptions') {
          admin();
          const body = await readBody(req);
          let subscriber;
          try { subscriber = validateSubscription(body); } catch { throw fail(400, 'Invalid subscription'); }
          if (req.method === 'POST') {
            if (subscriber.kind === 'web' ? !notifier.publicConfig.web : !notifier.publicConfig.android) throw fail(503, 'Push is not configured');
            await store.mutate(data => { data.subscriptions = data.subscriptions.filter(row => row.id !== subscriber.id); data.subscriptions.push(subscriber); });
          } else if (req.method === 'DELETE') await store.mutate(data => { data.subscriptions = data.subscriptions.filter(row => row.id !== subscriber.id); });
          else throw fail(405, 'Method not allowed');
          return json(200, { ok: true });
        }
        if (url.pathname === '/api/requests' && req.method === 'POST') {
          if (!clientHash) throw fail(400, 'Client token required');
          const body = await readBody(req), input = validateDemand(body);
          if (typeof body.id !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(body.id)) throw fail(400, 'Stable request ID required');
          const result = await store.mutate(data => {
            const existing = data.requests.find(row => row.clientHash === clientHash && row.clientRequestId === body.id);
            if (existing) return existing;
            const request = { ...input, id: crypto.randomUUID(), clientHash, clientRequestId: body.id };
            data.requests.push(request);
            data.outbox.push({ requestId: request.id, attempts: 0, nextAt: now, completed: [] });
            return request;
          });
          json(201, publicRow(result));
          setImmediate(pump);
          return;
        }
        if (url.pathname === '/api/requests' && req.method === 'GET') { admin(); return json(200, (await store.read()).requests.map(publicRow)); }
        const match = url.pathname.match(/^\/api\/requests\/([A-Za-z0-9_-]+)$/);
        if (match) {
          const request = (await store.read()).requests.find(row => row.id === match[1]);
          if (!request || (!session && (!clientHash || request.clientHash !== clientHash))) throw fail(404, 'Not found');
          if (req.method === 'GET') return json(200, publicRow(request));
          if (req.method === 'DELETE') { admin(); await store.mutate(data => { data.requests = data.requests.filter(row => row.id !== request.id); data.outbox = data.outbox.filter(row => row.requestId !== request.id); }); return json(200, { ok: true }); }
          if (req.method === 'PATCH') {
            const body = await readBody(req), patch = {};
            const fields = session ? ['status', 'autoSent', 'aiResult', 'finalResult', 'historyId'] : ['aiResult', 'historyId'];
            for (const key of fields) if (body[key] != null) {
              if (key === 'status') { if (!['pending', 'processing', 'delivered'].includes(body[key])) throw fail(400, 'Invalid status'); patch[key] = body[key]; }
              else if (key === 'autoSent') { if (typeof body[key] !== 'boolean') throw fail(400, 'Invalid value'); patch[key] = body[key]; }
              else { if (typeof body[key] !== 'string' || body[key].length > 1500000) throw fail(400, 'Invalid value'); patch[key] = body[key]; }
            }
            // Existing client auto-send workflow can only mark its own completed render.
            if (!session && body.status === 'delivered' && body.autoSent === true && body.aiResult) { patch.status = 'delivered'; patch.autoSent = true; }
            const result = await store.mutate(data => { const row = data.requests.find(row => row.id === request.id); Object.assign(row, patch); return row; });
            return json(200, publicRow(result));
          }
        }
        throw fail(404, 'API route not found');
      }
      // Optional same-origin hosting; no offline cache of admin data or personal information.
      const root = path.resolve(__dirname, '..', 'dist');
      const pathname = decodeURIComponent(url.pathname);
      let file = path.resolve(root, '.' + pathname);
      if (!file.startsWith(root + path.sep) && file !== root) throw fail(403, 'Forbidden');
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        if (/^\/(assets|_expo)\//.test(pathname) || /\.(js|json|ico)$/.test(pathname)) throw fail(404, 'Asset not found');
        file = path.join(root, 'index.html');
      }
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': /^\/(assets|_expo)\//.test(pathname) ? 'public, max-age=31536000, immutable' : 'no-cache' });
      fs.createReadStream(file).pipe(res);
    } catch (error) { if (!res.headersSent) json(error.status || 500, { error: error.status ? error.message : 'Server error' }); else res.end(); }
  });
  server.requestTimeout = 15000;
  server.on('close', () => clearInterval(timer));
  return { server, pump, store };
}
if (require.main === module) {
  const backend = createBackend();
  backend.server.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => { console.log('Demand backend listening'); backend.pump(); });
}
module.exports = { createBackend, passwordMatches };
