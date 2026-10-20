const crypto = require('node:crypto');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const canonicalPhone = input => {
  let phone = String(input || '').replace(/[\s().-]/g, '').replace(/^00/, '+');
  if (/^0[5-7]\d{8}$/.test(phone)) phone = '212' + phone.slice(1);
  return '+' + phone.replace(/^\+/, '');
};
const fail = (status, code) => Object.assign(new Error(code), { status });
const toUser = row => row && ({ id: row.id, name: row.name, whatsapp: row.phone, credits: row.credits + (row.free_used ? 0 : 1), freeUsed: row.free_used, leadDone: true, role: 'user', createdAt: row.created_at });

/** Phone-based client profiles, sessions, free/paid entitlement claims and per-client history/chat space. */
function createClients(db) {
  const byId = async (id, q = db.query) => (await q('SELECT * FROM clients WHERE id=$1', [id]))[0];
  async function login(name, input) {
    const canonical = canonicalPhone(input);
    if (!/^\+[1-9]\d{5,14}$/.test(canonical) || typeof name !== 'string' || name.trim().length < 2 || name.length > 120) throw fail(400, 'INVALID_PROFILE');
    // Atomic upsert: two simultaneous first logins for one phone cannot create two profiles.
    await db.query('INSERT INTO clients(id,phone,name,created_at) VALUES($1,$2,$3,$4) ON CONFLICT (phone) DO NOTHING', [crypto.randomUUID(), canonical, name.trim(), Date.now()]);
    const row = (await db.query('SELECT * FROM clients WHERE phone=$1', [canonical]))[0];
    const token = crypto.randomBytes(32).toString('hex');
    await db.query('DELETE FROM user_sessions WHERE expires_at<=$1', [Date.now()]);
    await db.query('INSERT INTO user_sessions VALUES($1,$2,$3)', [digest(token), row.id, Date.now() + 365 * 86400000]);
    return { token, user: toUser(row) };
  }
  async function authenticate(token) {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const rows = await db.query('SELECT c.* FROM user_sessions s JOIN clients c ON c.id=s.client_id WHERE s.token_hash=$1 AND s.expires_at>$2', [digest(token), Date.now()]);
    return toUser(rows[0]) || null;
  }
  /** Idempotent: replaying the same claim id never charges twice; the first free claim is atomic. */
  async function claim(client, id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(id)) throw fail(400, 'INVALID_CLAIM');
    return db.tx(async q => {
      await q('SELECT id FROM clients WHERE id=$1 FOR UPDATE', [client.id]); // serialises concurrent claims per client
      const old = (await q('SELECT * FROM claims WHERE id=$1', [id]))[0];
      if (old) { if (old.client_id !== client.id) throw fail(409, 'INVALID_CLAIM'); return toUser(await byId(client.id, q)); }
      const row = await byId(client.id, q);
      const free = !row.free_used;
      if (!free && row.credits <= 0) throw fail(402, 'PRO_REQUIRED');
      await q(free ? 'UPDATE clients SET free_used=1 WHERE id=$1' : 'UPDATE clients SET credits=credits-1 WHERE id=$1', [client.id]);
      await q('INSERT INTO claims VALUES($1,$2,$3)', [id, client.id, free ? 1 : 0]);
      return toUser(await byId(client.id, q));
    });
  }
  const listSpace = async (client, kind) => (await db.query('SELECT value FROM space WHERE client_id=$1 AND kind=$2', [client.id, kind])).map(row => JSON.parse(row.value));
  async function putSpace(client, kind, value, id) {
    const existing = (await db.query('SELECT client_id,kind FROM space WHERE id=$1', [id]))[0];
    if (existing && (existing.client_id !== client.id || existing.kind !== kind)) throw fail(404, 'NOT_FOUND');
    const next = { ...value, id, userId: client.id };
    await db.query('INSERT INTO space VALUES($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET value=EXCLUDED.value', [id, client.id, kind, JSON.stringify(next)]);
    return next;
  }
  return {
    login, authenticate, claim, listSpace, putSpace,
    hasClaim: async (id, clientId) => !!(await db.query('SELECT 1 FROM claims WHERE id=$1 AND client_id=$2', [id, clientId]))[0],
    user: async id => toUser(await byId(id)),
    logout: async token => { if (token) await db.query('DELETE FROM user_sessions WHERE token_hash=$1', [digest(token)]); },
    users: async () => (await db.query('SELECT * FROM clients ORDER BY created_at DESC')).map(toUser),
    grant: async (id, credits) => {
      const row = await byId(id);
      if (!row) throw fail(404, 'NOT_FOUND');
      if (!Number.isSafeInteger(credits) || credits < 0 || credits > 1000000) throw fail(400, 'INVALID_CREDITS');
      await db.query('UPDATE clients SET credits=$1 WHERE id=$2', [Math.max(0, credits - (row.free_used ? 0 : 1)), id]);
      return toUser(await byId(id));
    },
    removeSpace: (client, kind, id) => db.query('DELETE FROM space WHERE id=$1 AND client_id=$2 AND kind=$3', [id, client.id, kind]),
  };
}
module.exports = { createClients, canonicalPhone };
