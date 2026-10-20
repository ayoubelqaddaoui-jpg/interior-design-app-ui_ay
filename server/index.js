const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { isIP } = require('node:net');
const crypto = require('node:crypto');
const { createDb } = require('./db');
const { createClients } = require('./clients');
const { createNotifier, validateSubscription, trim, phone } = require('./notifications');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
function passwordMatches(password, encoded) {
  const [salt, digest] = String(encoded || '').split(':');
  if (!salt || !digest || !/^[a-f0-9]{128}$/.test(digest)) return false;
  return crypto.timingSafeEqual(crypto.scryptSync(String(password), salt, 64), Buffer.from(digest, 'hex'));
}
// Built-in default admin login (admin / admin) unless DISABLE_DEFAULT_ADMIN=true. ADMIN_EMAIL / ADMIN_PASSWORD_HASH work in addition.
function adminCredentialsMatch(env, email, password) {
  const user = email.trim().toLowerCase();
  if (env.DISABLE_DEFAULT_ADMIN !== 'true' && user === 'admin' && password === 'admin') return true;
  return !!env.ADMIN_EMAIL && user === env.ADMIN_EMAIL.toLowerCase() && passwordMatches(password, env.ADMIN_PASSWORD_HASH);
}
async function readBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail(415, 'JSON required');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) throw fail(413, 'Request too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw fail(400, 'Invalid JSON'); }
}
function validateDemand(value) {
  const name = trim(value?.name, 120), whatsapp = phone(value?.whatsapp);
  if (name.length < 2 || !/^\+?\d{6,20}$/.test(whatsapp)) throw fail(400, 'Name and phone required');
  if (typeof value.photoUri !== 'string' || value.photoUri.length > 3000000 || !/^(data:image\/(png|jpeg|webp);base64,|https?:\/\/)/.test(value.photoUri)) throw fail(400, 'Invalid photo');
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
const withTimeout = (promise, ms) => Promise.race([promise, new Promise(resolve => setTimeout(resolve, ms))]);

function createBackend({ env = process.env, db = createDb(env), senders } = {}) {
  const notifier = createNotifier(db, env, senders);
  const clients = createClients(db);
  const trustedProxies = new Set(String(env.TRUSTED_PROXY_IPS || '').split(',').map(value => value.trim()).filter(Boolean));
  const address = req => {
    const remote = req.socket?.remoteAddress || 'unknown';
    const forwarded = req.headers['x-real-ip'];
    return trustedProxies.has(remote) && typeof forwarded === 'string' && isIP(forwarded) ? forwarded : remote;
  };
  const allowedOrigins = String(env.APP_ORIGINS || 'http://localhost:4173,http://localhost:8080').split(',').map(value => value.trim());
  const apiLimit = Math.max(300, Math.min(5000, Number(env.API_RATE_LIMIT) || 300));
  const buckets = new Map();
  const rowOf = row => JSON.parse(row.data);
  const publicRow = ({ clientHash: ignored, clientRequestId: ignored2, ...row }) => row;

  /** Deliver due notification jobs. A short lease stops concurrent instances sending the same job twice. */
  async function pump(only) {
    try {
      const now = Date.now();
      const due = await db.query(only ? 'SELECT * FROM outbox WHERE request_id=$1 AND next_at<=$2' : 'SELECT * FROM outbox WHERE next_at<=$1 ORDER BY next_at LIMIT 20', only ? [only, now] : [now]);
      for (const job of due) {
        const leased = await db.query('UPDATE outbox SET next_at=$1 WHERE request_id=$2 AND next_at=$3 RETURNING request_id', [now + 60000, job.request_id, job.next_at]);
        if (!leased.length) continue;
        const demand = (await db.query('SELECT data FROM requests WHERE id=$1', [job.request_id]))[0];
        if (!demand) { await db.query('DELETE FROM outbox WHERE request_id=$1', [job.request_id]); continue; }
        try {
          const result = await notifier.deliver(rowOf(demand), JSON.parse(job.completed));
          if (!result.retry || job.attempts >= 6) await db.query('DELETE FROM outbox WHERE request_id=$1', [job.request_id]);
          else await db.query('UPDATE outbox SET completed=$1, attempts=attempts+1, next_at=$2 WHERE request_id=$3', [JSON.stringify(result.completed), Date.now() + Math.min(3600000, 30000 * 2 ** (job.attempts + 1)), job.request_id]);
        } catch { console.warn('Demand notification job deferred'); }
      }
    } catch { console.warn('Notification queue temporarily unavailable'); }
  }

  async function handle(req, res) {
    const origin = req.headers.origin;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        // Same-origin needs no configuration; other origins need an explicit allowlist.
        const sameOrigin = origin && /^https?:\/\//.test(origin) && new URL(origin).host === req.headers.host;
        if (origin && !sameOrigin && !allowedOrigins.includes(origin)) throw fail(403, 'Origin not allowed');
        if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Vary', 'Origin'); }
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Demand-Token, X-Dwira-Native, X-User-Token');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
        if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
        const key = `${address(req)}:${url.pathname === '/api/admin/login' ? 'login' : 'api'}`;
        const now = Date.now();
        if (buckets.size > 10000) for (const [id, bucket] of buckets) if (bucket.until < now) buckets.delete(id);
        const bucket = buckets.get(key) || { count: 0, until: now + 15 * 60000 };
        if (bucket.until < now) { bucket.count = 0; bucket.until = now + 15 * 60000; }
        bucket.count++; buckets.set(key, bucket);
        if (bucket.count > (url.pathname === '/api/admin/login' ? 20 : apiLimit)) throw fail(429, 'Too many requests');

        if (url.pathname === '/api/health' && req.method === 'GET') {
          // Never exposes secrets: only whether the database is reachable.
          let database = 'missing';
          try { if (db.configured()) database = await db.info(); } catch { database = 'error'; }
          return json(database === 'error' || database === 'missing' ? 503 : 200, { ok: database !== 'error' && database !== 'missing', runtime: process.versions.bun ? 'bun' : 'node', database, adminConfigured: !!(env.ADMIN_EMAIL && env.ADMIN_PASSWORD_HASH) });
        }
        if (!db.configured()) throw fail(503, 'DATABASE_NOT_CONFIGURED');

        const rawCookie = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('dwira_admin='))?.slice(12);
        const sessionToken = req.headers.authorization?.replace(/^Bearer /, '') || rawCookie;
        const session = sessionToken && (await db.query('SELECT token_hash FROM admin_sessions WHERE token_hash=$1 AND expires_at>$2', [hash(sessionToken), now]))[0];
        const admin = () => { if (!session) throw fail(401, 'Admin login required'); };
        const clientToken = req.headers['x-demand-token'];
        const clientHash = typeof clientToken === 'string' && /^[a-f0-9]{64}$/.test(clientToken) ? hash(clientToken) : null;
        const userCookie = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('dwira_user='))?.slice(11);
        const userToken = req.headers['x-user-token'] || userCookie;
        const client = await clients.authenticate(userToken);
        const requireUser = () => { if (!client) throw fail(401, 'USER_LOGIN_REQUIRED'); return client; };
        const cookie = (name, token, age) => `${name}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${age}${env.COOKIE_SECURE === 'false' ? '' : '; Secure'}`;

        // ---- Client accounts ----
        if (url.pathname === '/api/user/login' && req.method === 'POST') {
          const body = await readBody(req);
          const result = await clients.login(body.name, body.phone);
          res.setHeader('Set-Cookie', cookie('dwira_user', result.token, 365 * 86400));
          return json(200, { user: result.user, ...(req.headers['x-dwira-native'] === '1' ? { token: result.token } : {}) });
        }
        if (url.pathname === '/api/user/session' && req.method === 'GET') return json(200, { user: requireUser() });
        if (url.pathname === '/api/user/logout' && req.method === 'POST') {
          await clients.logout(userToken);
          res.setHeader('Set-Cookie', cookie('dwira_user', '', 0));
          return json(200, { ok: true });
        }
        if (url.pathname === '/api/user/claim' && req.method === 'POST') {
          const body = await readBody(req);
          return json(200, { user: await clients.claim(requireUser(), body.id) });
        }
        if (url.pathname === '/api/user/requests' && req.method === 'GET') {
          requireUser();
          return json(200, (await db.query('SELECT data FROM requests WHERE user_id=$1 ORDER BY created_at DESC', [client.id])).map(row => publicRow(rowOf(row))));
        }
        const space = url.pathname.match(/^\/api\/user\/(history|conversations)(?:\/([A-Za-z0-9_-]{1,100}))?$/);
        if (space) {
          requireUser();
          const kind = space[1], id = space[2];
          if (req.method === 'GET') {
            const rows = await clients.listSpace(client, kind);
            if (!id) return json(200, rows);
            const row = rows.find(row => row.id === id);
            if (!row) throw fail(404, 'NOT_FOUND');
            return json(200, row);
          }
          if (req.method === 'DELETE' && id) { await clients.removeSpace(client, kind, id); return json(200, { ok: true }); }
          if (req.method === 'POST' || req.method === 'PATCH' && id) {
            const body = await readBody(req);
            const existing = id && (await clients.listSpace(client, kind)).find(row => row.id === id);
            if (id && !existing) throw fail(404, 'NOT_FOUND');
            if (req.method === 'POST' && kind === 'history' && !(await clients.hasClaim(body.claimId, client.id))) throw fail(403, 'CLAIM_REQUIRED');
            const value = { ...existing, ...body };
            if (kind === 'history' && (!value.draft?.toolId || typeof value.before !== 'string' || !['pending', 'done'].includes(value.status))) throw fail(400, 'INVALID_HISTORY');
            if (kind === 'conversations' && (!Array.isArray(value.messages) || value.messages.length > 1000 || typeof value.title !== 'string')) throw fail(400, 'INVALID_CONVERSATION');
            return json(200, await clients.putSpace(client, kind, value, id || (kind === 'history' ? body.claimId : crypto.randomUUID())));
          }
          throw fail(405, 'Method not allowed');
        }

        // ---- Admin ----
        if (url.pathname === '/api/admin/clients' && req.method === 'GET') { admin(); return json(200, await clients.users()); }
        const creditClient = url.pathname.match(/^\/api\/admin\/clients\/([a-f0-9-]+)$/);
        if (creditClient && req.method === 'PATCH') { admin(); const body = await readBody(req); return json(200, await clients.grant(creditClient[1], body.credits)); }
        if (req.method === 'POST' && url.pathname === '/api/admin/login') {
          const body = await readBody(req);
          if (typeof body.email !== 'string' || typeof body.password !== 'string' || body.password.length > 512 || !adminCredentialsMatch(env, body.email, body.password)) throw fail(401, 'Invalid credentials');
          const token = crypto.randomBytes(32).toString('hex');
          await db.query('DELETE FROM admin_sessions WHERE expires_at<=$1', [now]);
          await db.query('INSERT INTO admin_sessions VALUES($1,$2)', [hash(token), now + 7 * 86400000]);
          res.setHeader('Set-Cookie', cookie('dwira_admin', token, 604800));
          return json(200, { ok: true, user: { id: 'usr_admin', name: 'Admin' }, ...(req.headers['x-dwira-native'] === '1' ? { token } : {}) });
        }
        if (req.method === 'GET' && url.pathname === '/api/admin/session') { admin(); return json(200, { ok: true }); }
        if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
          if (session) await db.query('DELETE FROM admin_sessions WHERE token_hash=$1', [session.token_hash]);
          res.setHeader('Set-Cookie', cookie('dwira_admin', '', 0));
          return json(200, { ok: true });
        }

        // ---- Notifications for new requests ----
        if (req.method === 'GET' && url.pathname === '/api/push/config') return json(200, await notifier.config());
        if (url.pathname === '/api/push/subscriptions') {
          admin();
          const body = await readBody(req);
          let subscriber;
          try { subscriber = validateSubscription(body); } catch { throw fail(400, 'Invalid subscription'); }
          if (req.method === 'POST') {
            if (subscriber.kind === 'fcm' && !(await notifier.config()).android) throw fail(503, 'Push is not configured');
            await notifier.save(subscriber);
          } else if (req.method === 'DELETE') await notifier.remove(subscriber.id);
          else throw fail(405, 'Method not allowed');
          return json(200, { ok: true });
        }
        if (url.pathname === '/api/push/test' && req.method === 'POST') {
          admin();
          const total = await notifier.count();
          if (!total) throw fail(409, 'NO_SUBSCRIPTION');
          const result = await withTimeout(notifier.deliver({ id: 'test', name: 'Test', whatsapp: '+212600000000' }, []), 12000);
          return json(200, { ok: !!result && !result.retry, devices: total });
        }
        // Retry queue trigger for Vercel Cron (Authorization: Bearer $CRON_SECRET) or an admin session.
        if (url.pathname === '/api/push/pump' && (req.method === 'GET' || req.method === 'POST')) {
          if (!session && !(env.CRON_SECRET && req.headers.authorization === `Bearer ${env.CRON_SECRET}`)) throw fail(401, 'Admin login required');
          await withTimeout(pump(), 25000);
          return json(200, { ok: true });
        }

        // ---- Render requests ----
        if (url.pathname === '/api/requests' && req.method === 'POST') {
          if (!clientHash) throw fail(400, 'Client token required');
          requireUser();
          const body = await readBody(req), input = validateDemand({ ...body, userId: client.id, name: client.name, whatsapp: client.whatsapp });
          if (typeof body.id !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(body.id)) throw fail(400, 'Stable request ID required');
          await clients.claim(client, body.id);
          const request = { ...input, id: crypto.randomUUID(), clientHash, clientRequestId: body.id };
          const inserted = await db.query('INSERT INTO requests(id,user_id,client_request_id,created_at,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT (user_id, client_request_id) DO NOTHING RETURNING id', [request.id, client.id, body.id, request.createdAt, JSON.stringify(request)]);
          if (inserted.length) await db.query('INSERT INTO outbox(request_id,attempts,next_at,completed) VALUES($1,0,$2,$3)', [request.id, now, '[]']);
          const stored = rowOf((await db.query('SELECT data FROM requests WHERE user_id=$1 AND client_request_id=$2', [client.id, body.id]))[0]);
          // The demand is already durable. Serverless functions freeze after the response, so send the
          // notification now (bounded) instead of in the background; failures stay queued for retry.
          if (inserted.length) await withTimeout(pump(request.id), Number(env.PUSH_WAIT_MS) || 8000);
          return json(201, publicRow(stored));
        }
        if (url.pathname === '/api/requests' && req.method === 'GET') {
          admin();
          void pump();
          return json(200, (await db.query('SELECT data FROM requests ORDER BY created_at DESC')).map(row => publicRow(rowOf(row))));
        }
        const match = url.pathname.match(/^\/api\/requests\/([A-Za-z0-9_-]+)$/);
        if (match) {
          const found = (await db.query('SELECT data FROM requests WHERE id=$1', [match[1]]))[0];
          const request = found && rowOf(found);
          if (!request || (!session && (!client || request.userId !== client.id))) throw fail(404, 'Not found');
          if (req.method === 'GET') return json(200, publicRow(request));
          if (req.method === 'DELETE') { admin(); await db.query('DELETE FROM outbox WHERE request_id=$1', [request.id]); await db.query('DELETE FROM requests WHERE id=$1', [request.id]); return json(200, { ok: true }); }
          if (req.method === 'PATCH') {
            const body = await readBody(req), patch = {};
            const fields = session ? ['status', 'autoSent', 'aiResult', 'finalResult', 'historyId'] : ['aiResult', 'historyId'];
            for (const field of fields) if (body[field] != null) {
              if (field === 'status') { if (!['pending', 'processing', 'delivered'].includes(body[field])) throw fail(400, 'Invalid status'); patch[field] = body[field]; }
              else if (field === 'autoSent') { if (typeof body[field] !== 'boolean') throw fail(400, 'Invalid value'); patch[field] = body[field]; }
              else { if (typeof body[field] !== 'string' || body[field].length > 3000000) throw fail(400, 'Invalid value'); patch[field] = body[field]; }
            }
            // The client's own auto-send workflow may only mark its own completed render.
            if (!session && body.status === 'delivered' && body.autoSent === true && body.aiResult) { patch.status = 'delivered'; patch.autoSent = true; }
            const result = await db.tx(async q => {
              const current = rowOf((await q('SELECT data FROM requests WHERE id=$1 FOR UPDATE', [request.id]))[0]);
              const next = Object.assign(current, patch);
              await q('UPDATE requests SET data=$1 WHERE id=$2', [JSON.stringify(next), request.id]);
              return next;
            });
            if (result.status === 'delivered' && result.historyId && (result.finalResult || result.aiResult)) {
              const owner = await clients.user(result.userId);
              const item = owner && (await clients.listSpace(owner, 'history')).find(row => row.id === result.historyId);
              if (item) await clients.putSpace(owner, 'history', { ...item, after: result.finalResult || result.aiResult, status: 'done' }, item.id);
            }
            return json(200, publicRow(result));
          }
        }
        throw fail(404, 'API route not found');
      }
      // Optional same-origin static hosting (Node/Bun server only; Vercel serves dist/ itself).
      const root = path.resolve(env.STATIC_DIR || path.join(__dirname, '..', 'dist'));
      const pathname = decodeURIComponent(url.pathname);
      let file = path.resolve(root, '.' + pathname);
      if (!file.startsWith(root + path.sep) && file !== root) throw fail(403, 'Forbidden');
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        if (/^\/(assets|_expo)\//.test(pathname) || /\.(js|json|ico|webmanifest|png)$/.test(pathname)) throw fail(404, 'Asset not found');
        file = path.join(root, 'index.html');
      }
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': /^\/(assets|_expo)\//.test(pathname) ? 'public, max-age=31536000, immutable' : 'no-cache' });
      fs.createReadStream(file).pipe(res);
    } catch (error) {
      if (!error.status) console.warn('API error', error.code || error.message);
      if (!res.headersSent) json(error.status || 500, { error: error.status ? error.message : 'Server error' }); else res.end();
    }
  }
  const server = http.createServer(handle);
  server.requestTimeout = 30000;
  const timer = setInterval(() => { void pump(); }, 15000);
  timer.unref();
  server.on('close', () => { clearInterval(timer); void db.close(); });
  return { server, handle, pump, db, clients, notifier };
}
if (require.main === module) {
  const backend = createBackend();
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD_HASH) console.warn('Custom admin credentials are not configured: the default login admin / admin is active.');
  backend.server.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => { console.log(`Dwira backend listening on port ${process.env.PORT || 8080} (${process.versions.bun ? 'Bun' : 'Node.js'})`); void backend.pump(); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => backend.server.close());
}
module.exports = { createBackend, passwordMatches };
