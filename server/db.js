/**
 * One tiny async Postgres interface for every runtime:
 *  - production / Vercel: `pg` against DATABASE_URL (Neon, Vercel Postgres, Supabase, any Postgres)
 *  - local development and automated tests: PGlite (real Postgres compiled to WASM, no install, in-process)
 * Both speak the same SQL, so tests exercise the exact queries production runs.
 */
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

/** Lazily opened and schema-initialised once per process (one cold start on Vercel). */
function createDb(env = process.env) {
  const url = connectionString(env);
  let ready;
  const open = () => ready ||= (async () => {
    // PGlite is a dev/test dependency only. Production on Vercel must provide a real database,
    // because serverless instances have no durable disk.
    if (!url && env.VERCEL) throw Object.assign(new Error('DATABASE_NOT_CONFIGURED'), { status: 503 });
    const db = url ? await openPg(url) : await openLite(env.PGLITE_DIR === ':memory:' ? undefined : env.PGLITE_DIR || (env.NODE_ENV === 'test' ? undefined : require('node:path').join(__dirname, 'data', 'pglite')));
    await db.exec(SCHEMA);
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
