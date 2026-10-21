const crypto = require('node:crypto');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const canonicalPhone = input => {
  let phone = String(input || '').replace(/[\s().-]/g, '').replace(/^00/, '+');
  if (/^0[5-7]\d{8}$/.test(phone)) phone = '212' + phone.slice(1);
  return '+' + phone.replace(/^\+/, '');
};
const MAX_CREDITS = 1000000;
/**
 * A client who has not used the free design is shown `credits + 1`. To make the balance an admin types equal the balance
 * the user sees, a target of 0 also consumes the unused free design; any other target keeps it and stores the remainder.
 */
const balance = (row, shown) => (!row.free_used && shown <= 0 ? { credits: 0, freeUsed: 1 } : { credits: Math.max(0, shown - (row.free_used ? 0 : 1)), freeUsed: row.free_used });
const fail = (status, code) => Object.assign(new Error(code), { status });
const toUser = row => row && ({ id: row.id, name: row.name, whatsapp: row.phone, credits: row.credits + (row.free_used ? 0 : 1), freeUsed: row.free_used, leadDone: true, role: 'user', blocked: !!row.blocked, createdAt: row.created_at });

/** Phone-based client profiles, sessions, free/paid entitlement claims and per-client history/chat space. */
function createClients(db) {
  const byId = async (id, q = db.query) => (await q('SELECT * FROM clients WHERE id=$1', [id]))[0];
  async function login(name, input, defaultCredits = 1) {
    const canonical = canonicalPhone(input);
    if (!/^\+[1-9]\d{5,14}$/.test(canonical) || typeof name !== 'string' || name.trim().length < 2 || name.length > 120) throw fail(400, 'INVALID_PROFILE');
    // Atomic upsert: two simultaneous first logins for one phone cannot create two profiles.
    // The admin's "default credits" setting is the balance a new client starts with (free design included).
    const start = balance({ free_used: 0 }, Number.isSafeInteger(defaultCredits) && defaultCredits >= 0 ? Math.min(defaultCredits, MAX_CREDITS) : 1);
    const created = (await db.query('INSERT INTO clients(id,phone,name,created_at,credits,free_used) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (phone) DO NOTHING RETURNING id', [crypto.randomUUID(), canonical, name.trim(), Date.now(), start.credits, start.freeUsed])).length > 0;
    const row = (await db.query('SELECT * FROM clients WHERE phone=$1', [canonical]))[0];
    if (row.blocked) throw fail(403, 'ACCOUNT_BLOCKED');
    const token = crypto.randomBytes(32).toString('hex');
    await db.query('DELETE FROM user_sessions WHERE expires_at<=$1', [Date.now()]);
    await db.query('INSERT INTO user_sessions VALUES($1,$2,$3)', [digest(token), row.id, Date.now() + 365 * 86400000]);
    return { token, user: toUser(row), created };
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
      if (!row) throw fail(401, 'USER_LOGIN_REQUIRED');
      if (row.blocked) throw fail(403, 'ACCOUNT_BLOCKED');
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
      if (!Number.isSafeInteger(credits) || credits < 0 || credits > MAX_CREDITS) throw fail(400, 'INVALID_CREDITS');
      const next = balance(row, credits);
      await db.query('UPDATE clients SET credits=$1, free_used=$2 WHERE id=$3', [next.credits, next.freeUsed, id]);
      return toUser(await byId(id));
    },
    /** Admin edit of one client. Only whitelisted fields; credits are the displayed balance (free design included). */
    update: async (id, patch) => {
      if (patch.credits !== undefined && (!Number.isSafeInteger(patch.credits) || patch.credits < 0 || patch.credits > MAX_CREDITS)) throw fail(400, 'INVALID_CREDITS');
      if (patch.blocked !== undefined && typeof patch.blocked !== 'boolean') throw fail(400, 'INVALID_BLOCKED');
      return db.tx(async q => {
        const row = (await q('SELECT * FROM clients WHERE id=$1 FOR UPDATE', [id]))[0];
        if (!row) throw fail(404, 'NOT_FOUND');
        if (patch.credits !== undefined) { const next = balance(row, patch.credits); await q('UPDATE clients SET credits=$1, free_used=$2 WHERE id=$3', [next.credits, next.freeUsed, id]); }
        if (patch.blocked !== undefined) await q('UPDATE clients SET blocked=$1 WHERE id=$2', [patch.blocked ? 1 : 0, id]);
        return toUser(await byId(id, q));
      });
    },
    /**
     * Admin bulk action on many clients in ONE transaction (all or nothing).
     * action: block | unblock | delete | credits(mode: set | add | subtract, amount).
     */
    bulk: async ({ ids, action, mode, amount }) => {
      if (!Array.isArray(ids) || !ids.length || ids.length > 500 || ids.some(id => typeof id !== 'string' || !/^[a-f0-9-]{8,64}$/.test(id))) throw fail(400, 'INVALID_IDS');
      if (!['block', 'unblock', 'delete', 'credits'].includes(action)) throw fail(400, 'INVALID_ACTION');
      if (action === 'credits') {
        if (!['set', 'add', 'subtract'].includes(mode) || !Number.isSafeInteger(amount) || amount < 0 || amount > MAX_CREDITS) throw fail(400, 'INVALID_CREDITS');
      }
      const unique = [...new Set(ids)];
      return db.tx(async q => {
        const rows = [];
        for (const id of unique.sort()) { // stable lock order avoids deadlocks between concurrent bulk calls
          const row = (await q('SELECT * FROM clients WHERE id=$1 FOR UPDATE', [id]))[0];
          if (row) rows.push(row);
        }
        for (const row of rows) {
          if (action === 'delete') await q('DELETE FROM clients WHERE id=$1', [row.id]);
          else if (action === 'block' || action === 'unblock') await q('UPDATE clients SET blocked=$1 WHERE id=$2', [action === 'block' ? 1 : 0, row.id]);
          else {
            const shown = row.credits + (row.free_used ? 0 : 1);
            const next = Math.min(MAX_CREDITS, Math.max(0, mode === 'set' ? amount : mode === 'add' ? shown + amount : shown - amount));
            const stored = balance(row, next);
            await q('UPDATE clients SET credits=$1, free_used=$2 WHERE id=$3', [stored.credits, stored.freeUsed, row.id]);
          }
        }
        const users = [];
        if (action !== 'delete') for (const row of rows) users.push(toUser(await byId(row.id, q)));
        return { affected: rows.length, users };
      });
    },
    remove: async id => {
      const rows = await db.query('DELETE FROM clients WHERE id=$1 RETURNING id', [id]);
      if (!rows.length) throw fail(404, 'NOT_FOUND');
    },
    removeSpace: (client, kind, id) => db.query('DELETE FROM space WHERE id=$1 AND client_id=$2 AND kind=$3', [id, client.id, kind]),
  };
}
module.exports = { createClients, canonicalPhone };
