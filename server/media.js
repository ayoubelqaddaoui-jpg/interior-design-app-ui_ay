const crypto = require('node:crypto');

/**
 * Uploaded images used to be stored inline in content rows as `data:image/...;base64,...` strings. One such upload made the
 * public /api/content JSON ~1.7 MB, and Home cannot paint its first card before that JSON has arrived.
 * Large inline images are now moved to the `media` table (content-addressed by hash) and replaced by a short URL
 * `/api/media/<hash>.<ext>`, which browsers and the CDN cache forever and only download where the image is shown.
 */
const PREFIX = '/api/media/';
const INLINE = /^data:(image\/(?:png|jpeg|webp|gif|avif|svg\+xml));base64,/;
/** Small icons stay inline: an extra request would cost more than the bytes. */
const MIN_BYTES = 4096;
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg' };
const MIME = Object.fromEntries(Object.entries(EXT).map(([mime, ext]) => [ext, mime]));
const NAME = /^([a-f0-9]{32})\.(png|jpg|webp|gif|avif|svg)$/;
/** Native clients receive absolute media URLs; store them host-independent again. */
const ABSOLUTE = /^https?:\/\/[^/]+(\/api\/media\/[a-f0-9]{32}\.[a-z]+)$/;

function createMedia(db) {
  const saved = new Set();
  async function store(value) {
    const match = INLINE.exec(value);
    const mime = match[1];
    const data = value.slice(match[0].length);
    const id = crypto.createHash('sha256').update(data).digest('hex').slice(0, 32);
    if (!saved.has(id)) {
      await db.query('INSERT INTO media(id,mime,data,created_at) VALUES($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING', [id, mime, data, Date.now()]);
      saved.add(id);
    }
    return `${PREFIX}${id}.${EXT[mime]}`;
  }
  /** Returns a copy of `value` with every large inline image replaced by its media URL, plus whether anything changed. */
  async function externalize(value) {
    let changed = false;
    const walk = async node => {
      if (typeof node === 'string') {
        if (node.length > MIN_BYTES && INLINE.test(node)) { changed = true; return store(node); }
        const absolute = ABSOLUTE.exec(node);
        if (absolute) { changed = true; return absolute[1]; }
        return node;
      }
      if (Array.isArray(node)) return Promise.all(node.map(walk));
      if (node && typeof node === 'object') {
        const out = {};
        for (const [key, child] of Object.entries(node)) out[key] = await walk(child);
        return out;
      }
      return node;
    };
    const result = await walk(value);
    return { value: result, changed };
  }
  /** `name` = `<hash>.<ext>`; null when unknown. */
  async function read(name) {
    const match = NAME.exec(String(name || ''));
    if (!match) return null;
    const row = (await db.query('SELECT mime,data FROM media WHERE id=$1', [match[1]]))[0];
    if (!row || MIME[match[2]] !== row.mime) return null;
    return { mime: row.mime, body: Buffer.from(row.data, 'base64') };
  }
  return { externalize, read };
}
module.exports = { createMedia, MEDIA_PREFIX: PREFIX };
