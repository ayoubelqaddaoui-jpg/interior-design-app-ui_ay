// Keep the same SQLite schema and SQL on both runtimes; no service rewrite or data copy.
const DatabaseSync = process.versions.bun ? require('bun:sqlite').Database : require('node:sqlite').DatabaseSync;
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const canonicalPhone = input => {
  let phone = String(input || '').replace(/[\s().-]/g, '').replace(/^00/, '+');
  if (/^0[5-7]\d{8}$/.test(phone)) phone = '212' + phone.slice(1);
  return '+' + phone.replace(/^\+/, '');
};
const fail = (status, code) => Object.assign(new Error(code), { status });

/** Separate from the existing admin/request store. Signals never contain image bytes. */
function createClients(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  if (process.versions.bun) {
    Object.defineProperty(db, 'isTransaction', { get: () => db.inTransaction });
    // Bun's cached statements are finalized on close; unmanaged prepare() handles are not.
    db.prepare = db.query.bind(db);
  }
  if (file !== ':memory:') fs.chmodSync(file, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY, phone TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      free_used INTEGER NOT NULL DEFAULT 0, credits INTEGER NOT NULL DEFAULT 0,
      flagged INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS clients_phone ON clients(phone);
    CREATE TABLE IF NOT EXISTS user_sessions (token_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS signals (
      id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), phone TEXT NOT NULL,
      device_id TEXT NOT NULL, ip TEXT NOT NULL, image_hash TEXT NOT NULL, claimed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS signals_phone ON signals(phone);
    CREATE INDEX IF NOT EXISTS signals_device_id ON signals(device_id);
    CREATE INDEX IF NOT EXISTS signals_image_hash ON signals(image_hash);
    CREATE INDEX IF NOT EXISTS signals_ip ON signals(ip);
    CREATE TABLE IF NOT EXISTS claims (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), signal_id TEXT NOT NULL, free INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS space (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), kind TEXT NOT NULL, value TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS space_client ON space(client_id, kind);
    CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
    INSERT OR IGNORE INTO preferences VALUES ('block_spam', 0);`);
  const user = row => row && ({ id: row.id, name: row.name, whatsapp: row.phone, credits: row.credits + (row.free_used ? 0 : 1), freeUsed: row.free_used, leadDone: true, role: 'user', createdAt: row.created_at });
  const byId = id => db.prepare('SELECT * FROM clients WHERE id=?').get(id);
  const block = () => !!db.prepare("SELECT value FROM preferences WHERE key='block_spam'").get().value;
  function login(name, input) {
    // Canonical E.164-style spelling: 00 and + are equivalent. No device/image lookup.
    const canonical = canonicalPhone(input);
    if (!/^\+[1-9]\d{5,14}$/.test(canonical) || typeof name !== 'string' || name.trim().length < 2 || name.length > 120) throw fail(400, 'INVALID_PROFILE');
    let row = db.prepare('SELECT * FROM clients WHERE phone=?').get(canonical);
    if (!row) {
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO clients(id,phone,name,created_at) VALUES(?,?,?,?)').run(id, canonical, name.trim(), Date.now());
      row = byId(id);
    }
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('DELETE FROM user_sessions WHERE expires_at<=?').run(Date.now());
    db.prepare('INSERT INTO user_sessions VALUES(?,?,?)').run(digest(token), row.id, Date.now() + 365 * 86400000);
    return { token, user: user(row) };
  }
  const authenticate = token => {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const session = db.prepare('SELECT client_id FROM user_sessions WHERE token_hash=? AND expires_at>?').get(digest(token), Date.now());
    return session ? user(byId(session.client_id)) : null;
  };
  async function upload(req, client, device, address) {
    if (typeof device !== 'string' || !/^[a-f0-9]{64}$/.test(device)) throw fail(400, 'INVALID_DEVICE');
    if (!/^image\/(jpeg|png|webp)$/.test(req.headers['content-type'] || '')) throw fail(415, 'INVALID_IMAGE');
    const hash = crypto.createHash('sha256');
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 15 * 1024 * 1024) throw fail(413, 'IMAGE_TOO_LARGE');
      hash.update(chunk); // streaming, never Buffer.concat or additional image storage
    }
    if (!size) throw fail(400, 'EMPTY_IMAGE');
    const id = crypto.randomUUID();
    const ip = address || req.socket.remoteAddress || 'unknown'; // no untrusted forwarded IPs
    db.prepare('INSERT INTO signals(id,client_id,phone,device_id,ip,image_hash,created_at) VALUES(?,?,?,?,?,?,?)').run(id, client.id, client.whatsapp, device, ip, hash.digest('hex'), Date.now());
    return { uploadId: id };
  }
  function claim(client, id, uploadId) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(id)) throw fail(400, 'INVALID_CLAIM');
    db.exec('BEGIN IMMEDIATE');
    try {
      const old = db.prepare('SELECT * FROM claims WHERE id=?').get(id);
      if (old) {
        if (old.client_id !== client.id) throw fail(409, 'INVALID_CLAIM');
        db.exec('COMMIT'); return user(byId(client.id));
      }
      const signal = db.prepare('SELECT * FROM signals WHERE id=? AND client_id=?').get(uploadId, client.id);
      if (!signal) throw fail(400, 'UPLOAD_REQUIRED');
      const row = byId(client.id);
      const free = !row.free_used;
      const related = db.prepare(`SELECT DISTINCT client_id FROM signals WHERE phone<>? AND claimed=1 AND (device_id=? OR image_hash=? OR ip=?)`).all(signal.phone, signal.device_id, signal.image_hash, signal.ip);
      if (free && related.length) {
        db.prepare('UPDATE clients SET flagged=1 WHERE id=?').run(client.id);
        for (const other of related) db.prepare('UPDATE clients SET flagged=1 WHERE id=?').run(other.client_id);
      }
      if (free && block() && (row.flagged || related.length)) {
        db.exec('COMMIT'); throw fail(403, 'SPAM_BLOCKED');
      }
      if (!free && row.credits <= 0) throw fail(402, 'PRO_REQUIRED');
      db.prepare(free ? 'UPDATE clients SET free_used=1 WHERE id=?' : 'UPDATE clients SET credits=credits-1 WHERE id=?').run(client.id);
      if (free) db.prepare('UPDATE signals SET claimed=1 WHERE id=?').run(signal.id);
      db.prepare('INSERT INTO claims VALUES(?,?,?,?)').run(id, client.id, signal.id, free ? 1 : 0);
      db.exec('COMMIT');
      return user(byId(client.id));
    } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
  }
  function monitor(from, to, page = 1) {
    const where = 'created_at>=? AND created_at<=?';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM clients WHERE ${where}`).get(from, to).n;
    const flagged = db.prepare(`SELECT COUNT(*) AS n FROM clients WHERE flagged=1 AND ${where}`).get(from, to).n;
    const rows = db.prepare(`SELECT * FROM clients WHERE flagged=1 AND ${where} ORDER BY created_at DESC,id LIMIT 20 OFFSET ?`).all(from, to, (page - 1) * 20).map(row => {
      const signals = db.prepare('SELECT device_id,ip,image_hash,created_at FROM signals WHERE client_id=? ORDER BY created_at DESC').all(row.id);
      const accounts = new Set([row.id]);
      for (const signal of signals) for (const related of db.prepare('SELECT DISTINCT client_id FROM signals WHERE device_id=? OR image_hash=? OR ip=?').all(signal.device_id, signal.image_hash, signal.ip)) accounts.add(related.client_id);
      const freeUsed = [...accounts].reduce((sum, id) => sum + byId(id).free_used, 0);
      return { phone: row.phone, device: signals[0]?.device_id || '', ip: signals[0]?.ip || '', imageHash: signals[0]?.image_hash || '', accounts: accounts.size, freeUsed, date: row.created_at };
    });
    return { rows, total, flagged, percentage: total ? flagged / total * 100 : 0, page, pageSize: 20, block: block() };
  }
  function listSpace(client, kind) { return db.prepare('SELECT value FROM space WHERE client_id=? AND kind=?').all(client.id, kind).map(row => JSON.parse(row.value)); }
  function putSpace(client, kind, value, id) {
    const existing = db.prepare('SELECT * FROM space WHERE id=?').get(id);
    if (existing && (existing.client_id !== client.id || existing.kind !== kind)) throw fail(404, 'NOT_FOUND');
    const next = { ...value, id, userId: client.id };
    db.prepare('INSERT INTO space VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(id, client.id, kind, JSON.stringify(next));
    return next;
  }
  function importRequests(requests) {
    for (const request of requests) {
      if (byId(request.userId)) continue;
      const phone = canonicalPhone(request.whatsapp);
      if (!/^\+[1-9]\d{5,14}$/.test(phone)) continue;
      let row = db.prepare('SELECT * FROM clients WHERE phone=?').get(phone);
      if (!row) {
        const id = crypto.randomUUID();
        db.prepare('INSERT INTO clients(id,phone,name,free_used,created_at) VALUES(?,?,?,1,?)').run(id, phone, String(request.name || '').slice(0, 120), request.createdAt || Date.now());
        row = byId(id);
      } else db.prepare('UPDATE clients SET free_used=1 WHERE id=?').run(row.id);
      request.userId = row.id;
      const historyId = request.historyId || `legacy_${request.id}`;
      const existing = db.prepare('SELECT id FROM space WHERE id=?').get(historyId);
      if (!existing && request.photoUri && request.draft) {
        const delivered = request.status === 'delivered' && (request.finalResult || request.aiResult);
        putSpace(user(row), 'history', { before: request.photoUri, after: delivered || undefined, status: delivered ? 'done' : 'pending', draft: request.draft, createdAt: request.createdAt, requestId: request.id }, historyId);
      }
      request.historyId = historyId;
    }
  }
  return { importRequests, login, authenticate, upload, claim, monitor, user: id => user(byId(id)),
    logout: token => { if (token) db.prepare('DELETE FROM user_sessions WHERE token_hash=?').run(digest(token)); },
    setBlock: value => db.prepare("UPDATE preferences SET value=? WHERE key='block_spam'").run(value ? 1 : 0),
    users: () => db.prepare('SELECT * FROM clients').all().map(user),
    grant: (id, credits) => { if (!byId(id)) throw fail(404, 'NOT_FOUND'); if (!Number.isSafeInteger(credits) || credits < 0 || credits > 1000000) throw fail(400, 'INVALID_CREDITS'); db.prepare('UPDATE clients SET credits=? WHERE id=?').run(Math.max(0, credits - (byId(id).free_used ? 0 : 1)), id); return user(byId(id)); },
    listSpace, putSpace,
    removeSpace: (client, kind, id) => db.prepare('DELETE FROM space WHERE id=? AND client_id=? AND kind=?').run(id, client.id, kind),
    close: () => process.versions.bun ? db.close(true) : db.close(), db };
}
module.exports = { createClients };
