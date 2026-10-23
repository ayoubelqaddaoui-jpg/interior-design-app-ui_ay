const fs = require('node:fs');
const path = require('node:path');
const { createMedia } = require('./media');
const fail = (status, message) => Object.assign(new Error(message), { status });

/** Collections and documents that make up the app content. The database is their only source of truth. */
const COLLECTIONS = ['tabs', 'tools', 'roomTypes', 'styles', 'palettes', 'sections', 'categories', 'inspirations', 'models', 'plans'];
const DOCS = ['branding', 'theme', 'assistant', 'settings'];
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const LANGS = ['dar', 'ar', 'fr'];

let seedCache;
const loadSeed = () => seedCache ||= JSON.parse(fs.readFileSync(path.join(__dirname, 'seed-content.json'), 'utf8'));

function createContent(db, sync) {
  /**
   * First start only: copy the bundled starter content into the database. A flag row makes this run once, so
   * content an admin later deletes is never resurrected. Concurrent cold starts are safe (the flag insert wins once).
   */
  let seeded;
  const ensureSeed = () => seeded ||= (async () => {
    if ((await db.query("SELECT 1 FROM settings WHERE key='content_seeded'"))[0]) return;
    const seed = loadSeed(), now = Date.now();
    await db.tx(async q => {
      const claimed = await q("INSERT INTO settings(key,value) VALUES('content_seeded',$1) ON CONFLICT (key) DO NOTHING RETURNING key", [String(now)]);
      if (!claimed.length) return;
      for (const [coll, rows] of Object.entries(seed.collections)) for (const row of rows) await q('INSERT INTO content_items(coll,id,data,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [coll, row.id, JSON.stringify(row), now]);
      for (const [name, doc] of Object.entries(seed.docs)) await q('INSERT INTO content_docs(name,data,updated_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [name, JSON.stringify(doc), now]);
    });
  })().then(migrateMedia).catch(error => { seeded = undefined; throw error; });

  /**
   * Once per database: rows saved before media storage existed may hold multi-megabyte inline images. Move them out so the
   * public content JSON stays small (the 1.7 MB /api/content measured on the preview came from one uploaded room image).
   */
  const media = createMedia(db);
  async function migrateMedia() {
    if ((await db.query("SELECT 1 FROM settings WHERE key='media_migrated'"))[0]) return;
    let moved = 0;
    for (const row of await db.query("SELECT coll,id,data FROM content_items WHERE data LIKE '%data:image/%'")) {
      const { value, changed } = await media.externalize(JSON.parse(row.data));
      if (changed) { await db.query('UPDATE content_items SET data=$1 WHERE coll=$2 AND id=$3', [JSON.stringify(value), row.coll, row.id]); moved++; }
    }
    for (const row of await db.query("SELECT name,data FROM content_docs WHERE data LIKE '%data:image/%'")) {
      const { value, changed } = await media.externalize(JSON.parse(row.data));
      if (changed) { await db.query('UPDATE content_docs SET data=$1 WHERE name=$2', [JSON.stringify(value), row.name]); moved++; }
    }
    await db.query("INSERT INTO settings(key,value) VALUES('media_migrated',$1) ON CONFLICT (key) DO NOTHING", [String(Date.now())]);
    if (moved) await sync.bump('content');
  }

  /** Provider API keys are only ever returned to an authenticated admin. */
  const hideSecrets = row => ({ ...row, apiKey: '' });

  async function snapshot(isAdmin) {
    await ensureSeed();
    const collections = Object.fromEntries(COLLECTIONS.map(name => [name, []]));
    // Three independent reads: one round trip of waiting instead of three in a row.
    const [itemRows, docRows, versions] = await Promise.all([db.query('SELECT coll,data FROM content_items'), db.query('SELECT name,data FROM content_docs'), sync.read(['content'])]);
    for (const row of itemRows) {
      if (!collections[row.coll]) continue;
      const item = JSON.parse(row.data);
      collections[row.coll].push(row.coll === 'models' && !isAdmin ? hideSecrets(item) : item);
    }
    const docs = {};
    for (const row of docRows) docs[row.name] = JSON.parse(row.data);
    return { version: versions.content, collections, docs };
  }

  async function putItem(coll, id, body) {
    if (!COLLECTIONS.includes(coll)) throw fail(404, 'Unknown collection');
    if (!ID.test(id)) throw fail(400, 'Invalid id');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'Invalid item');
    await ensureSeed();
    const item = { ...(await media.externalize(body)).value, id };
    if (coll === 'models' && item.apiKey === undefined) {
      const old = (await db.query('SELECT data FROM content_items WHERE coll=$1 AND id=$2', [coll, id]))[0];
      if (old) item.apiKey = JSON.parse(old.data).apiKey ?? '';
    }
    await db.query('INSERT INTO content_items(coll,id,data,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT (coll,id) DO UPDATE SET data=EXCLUDED.data, updated_at=EXCLUDED.updated_at', [coll, id, JSON.stringify(item), Date.now()]);
    await sync.bump('content');
    return item;
  }
  async function deleteItems(coll, ids) {
    if (!COLLECTIONS.includes(coll)) throw fail(404, 'Unknown collection');
    if (!Array.isArray(ids) || ids.length > 500 || ids.some(id => typeof id !== 'string' || !ID.test(id))) throw fail(400, 'Invalid ids');
    await ensureSeed();
    for (const id of ids) await db.query('DELETE FROM content_items WHERE coll=$1 AND id=$2', [coll, id]);
    await sync.bump('content');
  }
  async function patchDoc(name, patch) {
    if (!DOCS.includes(name)) throw fail(404, 'Unknown document');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw fail(400, 'Invalid document');
    await ensureSeed();
    const clean = (await media.externalize(patch)).value; // outside the transaction: it writes media rows itself
    const next = await db.tx(async q => {
      const row = (await q('SELECT data FROM content_docs WHERE name=$1 FOR UPDATE', [name]))[0];
      const merged = { ...(row ? JSON.parse(row.data) : {}), ...clean };
      await q('INSERT INTO content_docs(name,data,updated_at) VALUES($1,$2,$3) ON CONFLICT (name) DO UPDATE SET data=EXCLUDED.data, updated_at=EXCLUDED.updated_at', [name, JSON.stringify(merged), Date.now()]);
      return merged;
    });
    await sync.bump('content');
    return next;
  }

  /** Preferences are stored per identity (one row per client, one per admin). */
  function cleanPrefs(input) {
    if (!input || typeof input !== 'object') throw fail(400, 'Invalid preferences');
    const out = {};
    if (input.notifications !== undefined) { if (typeof input.notifications !== 'boolean') throw fail(400, 'Invalid notifications'); out.notifications = input.notifications; }
    if (input.bannerDismissed !== undefined) { if (typeof input.bannerDismissed !== 'boolean') throw fail(400, 'Invalid banner'); out.bannerDismissed = input.bannerDismissed; }
    if (input.lang !== undefined) { if (!LANGS.includes(input.lang)) throw fail(400, 'Invalid language'); out.lang = input.lang; }
    return out;
  }
  const adminPrefs = async adminId => JSON.parse((await db.query('SELECT data FROM admin_prefs WHERE admin_id=$1', [adminId]))[0]?.data || '{}');
  const clientPrefs = async clientId => JSON.parse((await db.query('SELECT prefs FROM clients WHERE id=$1', [clientId]))[0]?.prefs || '{}');
  async function setAdminPrefs(adminId, patch) {
    const clean = cleanPrefs(patch);
    const next = { ...(await adminPrefs(adminId)), ...clean };
    await db.query('INSERT INTO admin_prefs(admin_id,data) VALUES($1,$2) ON CONFLICT (admin_id) DO UPDATE SET data=EXCLUDED.data', [adminId, JSON.stringify(next)]);
    await sync.bump(`a:${adminId}`);
    return next;
  }
  async function setClientPrefs(clientId, patch) {
    const clean = cleanPrefs(patch);
    const next = await db.tx(async q => {
      const row = (await q('SELECT prefs FROM clients WHERE id=$1 FOR UPDATE', [clientId]))[0];
      if (!row) throw fail(404, 'NOT_FOUND');
      const merged = { ...JSON.parse(row.prefs || '{}'), ...clean };
      await q('UPDATE clients SET prefs=$1 WHERE id=$2', [JSON.stringify(merged), clientId]);
      return merged;
    });
    await sync.bump(`c:${clientId}`);
    return next;
  }
  const getDoc = async name => { await ensureSeed(); const row = (await db.query('SELECT data FROM content_docs WHERE name=$1', [name]))[0]; return row ? JSON.parse(row.data) : {}; };
  return { media, getDoc, snapshot, putItem, deleteItems, patchDoc, adminPrefs, clientPrefs, setAdminPrefs, setClientPrefs, ensureSeed };
}
module.exports = { createContent, COLLECTIONS, DOCS };
