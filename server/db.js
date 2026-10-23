/**
 * One tiny async Postgres interface for every runtime:
 *  - production / Vercel: `pg` against DATABASE_URL (Neon, Vercel Postgres, Supabase, any Postgres)
 *  - local development and automated tests: PGlite (real Postgres compiled to WASM, no install, in-process)
 * Both speak the same SQL, so tests exercise the exact queries production runs.
 */
const crypto = require('node:crypto');
const connectionString = env => env.DATABASE_URL || env.POSTGRES_URL || env.POSTGRES_PRISMA_URL || env.POSTGRES_URL_NON_POOLING || '';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY, phone TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  free_used INTEGER NOT NULL DEFAULT 0, credits INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_sessions (token_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, expires_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS claims (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, free INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS space (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, kind TEXT NOT NULL, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS space_client ON space(client_id, kind);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS blocked INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, expires_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, client_request_id TEXT, created_at BIGINT NOT NULL, data TEXT NOT NULL,
  UNIQUE (user_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS requests_created ON requests(created_at DESC);
CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outbox (request_id TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, next_at BIGINT NOT NULL, completed TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS prefs TEXT NOT NULL DEFAULT '{}';
ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS admin_id TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'request';
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS payload TEXT;
CREATE TABLE IF NOT EXISTS content_items (coll TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at BIGINT NOT NULL, PRIMARY KEY (coll, id));
CREATE TABLE IF NOT EXISTS content_docs (name TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_prefs (admin_id TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, version BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data TEXT NOT NULL, created_at BIGINT NOT NULL);
`;

async function openPg(url) {
  const { Pool, types } = require('pg');
  types.setTypeParser(20, value => Number(value)); // BIGINT -> number (timestamps stay far below 2^53)
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const pool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 8000, ssl: local ? false : { rejectUnauthorized: false } });
  pool.on('error', () => {}); // idle client errors must never crash the function
  return {
    kind: 'pg',
    query: async (sql, params = []) => (await pool.query(sql, params)).rows,
    tx: async work => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work(async (sql, params = []) => (await client.query(sql, params)).rows);
        await client.query('COMMIT');
        return result;
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
    },
    exec: sql => pool.query(sql),
    close: () => pool.end(),
  };
}
async function openLite(dataDir) {
  // Built indirectly so Vercel's file tracer does not bundle the (dev-only) PGlite WASM into the function.
  const { PGlite } = require(['@electric-sql', 'pglite'].join('/'));
  if (dataDir) require('node:fs').mkdirSync(require('node:path').dirname(dataDir), { recursive: true, mode: 0o700 });
  const lite = new PGlite(dataDir || undefined);
  await lite.waitReady;
  return {
    kind: 'pglite',
    query: async (sql, params = []) => (await lite.query(sql, params)).rows,
    tx: work => lite.transaction(tx => work(async (sql, params = []) => (await tx.query(sql, params)).rows)),
    exec: sql => lite.exec(sql),
    close: () => lite.close(),
  };
}

/**
 * Marker row written after the schema was applied. Its value is a hash of SCHEMA, so editing the schema above makes the
 * next start re-apply it once, while every other cold start only pays for ONE cheap SELECT instead of ~40 DDL statements
 * (each of which takes a lock on a database that may have just woken up).
 */
const SCHEMA_VERSION = crypto.createHash('sha1').update(SCHEMA).digest('hex').slice(0, 12);
async function ensureSchema(db) {
  try {
    const marker = (await db.query("SELECT value FROM settings WHERE key='schema_version'"))[0];
    if (marker?.value === SCHEMA_VERSION) return;
  } catch { /* no settings table yet: fresh database */ }
  await db.exec(SCHEMA);
  await db.query("INSERT INTO settings(key,value) VALUES('schema_version',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [SCHEMA_VERSION]);
}

/** Lazily opened and schema-initialised once per process (one cold start on Vercel). */
function createDb(env = process.env) {
  const url = connectionString(env);
  let ready;
  const open = () => ready ||= (async () => {
    // PGlite is a dev/test dependency only. Production on Vercel must provide a real database,
    // because serverless instances have no durable disk.
    if (!url && env.VERCEL) throw Object.assign(new Error('DATABASE_NOT_CONFIGURED'), { status: 503 });
    const db = url ? await openPg(url) : await openLite(env.PGLITE_DIR === ':memory:' ? undefined : env.PGLITE_DIR || (env.NODE_ENV === 'test' ? undefined : require('node:path').join(__dirname, 'data', 'pglite')));
    await ensureSchema(db);
    return db;
  })().catch(error => { ready = undefined; throw error; });
  return {
    configured: () => !!url || !env.VERCEL,
    query: async (sql, params) => (await open()).query(sql, params),
    tx: async work => (await open()).tx(work),
    close: async () => { if (ready) { const db = await ready.catch(() => null); ready = undefined; await db?.close(); } },
    info: async () => (await open()).kind,
  };
}
module.exports = { createDb };
