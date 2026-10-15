const crypto = require('node:crypto');
const fail = message => Object.assign(new Error(message), { status: 400 });
const clean = (value, max) => String(value ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, max);
const limits = { headline: 120, body: 600, primary: 60, secondary: 60 };
function validateVersions(input) {
  if (!Array.isArray(input) || input.length > 26) throw fail('INVALID_VERSIONS');
  const ids = new Set();
  const rows = input.map(row => {
    if (!row || typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(row.id) || row.id === 'default' || ids.has(row.id)) throw fail('INVALID_VERSION_ID');
    ids.add(row.id);
    if (typeof row.enabled !== 'boolean' || !Number.isInteger(row.weight) || row.weight < 0 || row.weight > 100) throw fail('INVALID_WEIGHT');
    const texts = {};
    for (const lang of ['dar', 'ar', 'fr']) {
      const text = row.texts?.[lang];
      if (!text || !Array.isArray(text.benefits) || text.benefits.length > 4) throw fail('ALL_LANGUAGES_REQUIRED');
      texts[lang] = {};
      for (const [key, max] of Object.entries(limits)) {
        if (typeof text[key] !== 'string') throw fail('INVALID_TEXT');
        texts[lang][key] = clean(text[key], max);
        if (!texts[lang][key]) throw fail('TEXT_REQUIRED');
      }
      texts[lang].benefits = text.benefits.map(value => {
        if (typeof value !== 'string') throw fail('INVALID_TEXT');
        return clean(value, 140);
      }).filter(Boolean);
    }
    return { id: row.id, label: clean(row.label, 40) || row.id, enabled: row.enabled, weight: row.weight, texts };
  });
  const active = rows.filter(row => row.enabled);
  if (active.length > 1 && active.reduce((n, row) => n + row.weight, 0) !== 100) throw fail('WEIGHTS_MUST_TOTAL_100');
  return rows;
}
function createReturning(db, random = () => crypto.randomInt(1000000) / 1000000) {
  db.exec(`CREATE TABLE IF NOT EXISTS returning_versions (id TEXT PRIMARY KEY, value TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS returning_assignments (phone TEXT PRIMARY KEY, version_id TEXT NOT NULL, viewed INTEGER, clicked INTEGER, purchased INTEGER);
    CREATE INDEX IF NOT EXISTS returning_version_id ON returning_assignments(version_id);
    CREATE INDEX IF NOT EXISTS returning_phone ON returning_assignments(phone);
    CREATE TABLE IF NOT EXISTS returning_counts (version_id TEXT NOT NULL, day TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0, purchases INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(version_id, day));`);
  let cached = null;
  const versions = () => db.prepare('SELECT value FROM returning_versions WHERE deleted=0 ORDER BY rowid').all().map(row => JSON.parse(row.value));
  const active = () => cached ?? (cached = versions().filter(row => row.enabled));
  function save(input) {
    const rows = validateVersions(input);
    for (const row of rows) if (db.prepare('SELECT deleted FROM returning_versions WHERE id=?').get(row.id)?.deleted) throw fail('VERSION_DELETED');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE returning_versions SET deleted=1').run();
      for (const row of rows) {
        db.prepare('INSERT INTO returning_versions(id,value,deleted) VALUES(?,?,0) ON CONFLICT(id) DO UPDATE SET value=excluded.value,deleted=0').run(row.id, JSON.stringify(row));
      }
      db.exec('COMMIT'); cached = null;
      return versions();
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function message(client) {
    if (!client.freeUsed) return { eligible: false, version: null };
    const rows = active();
    let assignment = db.prepare('SELECT * FROM returning_assignments WHERE phone=?').get(client.whatsapp);
    if (!assignment && rows.length) {
      let selected = rows[0];
      if (rows.length > 1) {
        let threshold = random() * 100;
        selected = rows.find(row => { threshold -= row.weight; return threshold < 0; }) || rows[rows.length - 1];
      }
      db.prepare('INSERT OR IGNORE INTO returning_assignments(phone,version_id) VALUES(?,?)').run(client.whatsapp, selected.id);
      assignment = db.prepare('SELECT * FROM returning_assignments WHERE phone=?').get(client.whatsapp);
    }
    return { eligible: true, version: rows.find(row => row.id === assignment?.version_id) || null };
  }
  function event(client, versionId, kind) {
    if (!['view', 'click', 'upgrade_confirmation'].includes(kind)) throw fail('INVALID_EVENT');
    const column = { view: 'viewed', click: 'clicked', upgrade_confirmation: 'purchased' }[kind];
    // Upgrade attribution is phone-owned even after the Pro route was reloaded.
    if (kind === 'upgrade_confirmation' && versionId == null) {
      const assignment = db.prepare('SELECT * FROM returning_assignments WHERE phone=?').get(client.whatsapp);
      if (!assignment?.viewed || !assignment.clicked) return;
      versionId = assignment.version_id;
    }
    if (!column || typeof versionId !== 'string') throw fail('INVALID_EVENT');
    const row = db.prepare('SELECT * FROM returning_assignments WHERE phone=? AND version_id=?').get(client.whatsapp, versionId);
    if (!client.freeUsed || !row) throw fail('ASSIGNMENT_REQUIRED');
    if (kind !== 'view' && !row.viewed || kind === 'upgrade_confirmation' && !row.clicked) throw fail('FUNNEL_REQUIRED');
    if (row[column]) return;
    if (kind === 'view' && !active().some(v => v.id === versionId)) throw fail('VERSION_INACTIVE');
    const counter = { view: 'views', click: 'clicks', upgrade_confirmation: 'purchases' }[kind];
    const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`UPDATE returning_assignments SET ${column}=? WHERE phone=? AND ${column} IS NULL`).run(now, client.whatsapp);
      db.prepare(`INSERT INTO returning_counts(version_id,day,${counter}) VALUES(?,?,1) ON CONFLICT(version_id,day) DO UPDATE SET ${counter}=${counter}+1`).run(versionId, day);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function results(from = '0000-01-01', to = '9999-12-31') {
    for (const value of [from, to]) if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) throw fail('INVALID_DATE');
    if (from > to) throw fail('INVALID_DATE');
    return db.prepare('SELECT id,value,deleted FROM returning_versions ORDER BY rowid').all().map(row => {
      const counts = db.prepare('SELECT COALESCE(SUM(views),0) AS views, COALESCE(SUM(clicks),0) AS clicks, COALESCE(SUM(purchases),0) AS purchases FROM returning_counts WHERE version_id=? AND day>=? AND day<=?').get(row.id, from, to);
      return { id: row.id, label: JSON.parse(row.value).label, deleted: !!row.deleted, ...counts, conversion: counts.views ? counts.purchases / counts.views * 100 : 0 };
    });
  }
  return { versions, save, message, event, results };
}
module.exports = { createReturning, validateVersions };
