/**
 * Change versions for real-time sync. Every mutation bumps one or more keys in the database; devices poll the tiny
 * /api/sync endpoint and refetch only what changed. The counters live in Postgres, so every serverless instance
 * and every device sees the same numbers.
 *   content        shared app content + settings (public)
 *   requests       all render requests / leads (admin)
 *   clients        client list (admin)
 *   c:<clientId>   one client's profile, credits, history, chats, requests, prefs
 *   a:<adminId>    one admin's preferences
 */
function createSync(db) {
  const bump = async (...keys) => {
    for (const key of [...new Set(keys.filter(Boolean))]) {
      await db.query('INSERT INTO sync_state(key,version) VALUES($1,1) ON CONFLICT (key) DO UPDATE SET version=sync_state.version+1', [key]);
    }
  };
  const read = async keys => {
    const rows = await db.query('SELECT key,version FROM sync_state WHERE key = ANY($1)', [keys]);
    return Object.fromEntries(keys.map(key => [key, Number(rows.find(row => row.key === key)?.version ?? 0)]));
  };
  return { bump, read };
}
module.exports = { createSync };
