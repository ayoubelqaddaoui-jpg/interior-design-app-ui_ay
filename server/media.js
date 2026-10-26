const crypto = require('node:crypto');
const { downloadRemote, verifyMedia, IMAGE_TYPES, VIDEO_TYPES } = require('./remote-media');

/**
 * All media (images and videos) of the app goes through this module.
 *
 *  - storeMedia()  is the ONE write path: data URLs from uploads, images downloaded from external URLs, legacy rows moved by
 *                  the migration script. It stores the bytes in Cloudflare R2 (or, only when the R2 variables are missing,
 *                  as raw bytes in the `media` table) and returns a stable `/api/media/<hash>.<ext>` URL.
 *  - readMedia()   is the ONE read path behind GET /api/media/<name>: a redirect to the public R2 URL, or the bytes of a
 *                  row stored in the database (fallback mode, or legacy rows not migrated yet).
 *  - presignUpload() / completeUpload(): large files (videos) go from the admin's device straight to R2 with a 5-minute
 *                  presigned PUT. The server picks the key, the type and the exact size, then checks the object.
 *
 * Content rows only ever contain `/api/media/...` URLs: base64 is never written into content, requests or user spaces.
 * The `media` table keeps one small metadata row per file (id, mime, size, storage) so reads know where the file lives.
 */
const PREFIX = '/api/media/';
const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,/i;
const EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};
const MIME = Object.fromEntries(Object.entries(EXT).map(([mime, ext]) => [ext, mime]));
const NAME = /^([a-f0-9]{32})\.(png|jpg|webp|gif|avif|svg|mp4|webm|mov)$/;
/** Native clients receive absolute media URLs; store them host-independent again. */
const ABSOLUTE = /^https?:\/\/[^/]+(\/api\/media\/[a-f0-9]{32}\.[a-z0-9]+)$/;
/** Object keys whose string value is a picture shown by the app (external https URLs there are copied into storage). */
const MEDIA_KEYS = new Set(['image', 'cover', 'poster', 'logoUri', 'loaderCustomUri', 'photoUri', 'aiResult', 'finalResult', 'before', 'after', 'uri']);
const UPLOAD_EXPIRES = 300; // seconds: presigned PUT URLs are valid for 5 minutes
const PENDING_TTL = 3600000; // an upload must be completed within 1 hour of its presign
const CACHE = 'public, max-age=31536000, immutable';
const R2_VARS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL'];

const fail = (status, message) => Object.assign(new Error(message), { status });
const mb = (value, fallback) => Math.max(1, Math.min(5000, Number(value) || fallback)) * 1024 * 1024;
const limitsOf = env => ({ image: mb(env.MEDIA_MAX_IMAGE_MB, 10), video: mb(env.MEDIA_MAX_VIDEO_MB, 100) });
const kindOf = mime => (VIDEO_TYPES.includes(mime) ? 'video' : IMAGE_TYPES.includes(mime) ? 'image' : '');
const keyOf = name => `media/${name}`;
const idOf = body => crypto.createHash('sha256').update(body.toString('base64')).digest('hex').slice(0, 32);

/** 'r2' when every R2 variable is set, 'database' when none is, 'incomplete' otherwise (treated as missing). Never returns values. */
function r2Status(env = process.env) {
  const set = R2_VARS.filter(name => String(env[name] || '').trim());
  return set.length === R2_VARS.length ? 'r2' : set.length ? 'incomplete' : 'database';
}

/** Cloudflare R2 through the S3 API (region "auto"). `client` may be injected (tests); otherwise the SDK is loaded lazily. */
function createR2Storage(env = process.env, { client, presign } = {}) {
  if (r2Status(env) !== 'r2') return null;
  const bucket = env.R2_BUCKET.trim();
  const base = env.R2_PUBLIC_BASE_URL.trim().replace(/\/+$/, '');
  let sdk;
  const s3 = () => (sdk ||= require('@aws-sdk/client-s3'));
  let instance = client;
  const connection = () => (instance ||= new (s3().S3Client)({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID.trim(), secretAccessKey: env.R2_SECRET_ACCESS_KEY.trim() },
  }));
  const sign = presign || ((...args) => require('@aws-sdk/s3-request-presigner').getSignedUrl(...args));
  return {
    kind: 'r2',
    publicUrl: key => `${base}/${key}`,
    async put(key, body, mime) {
      await connection().send(new (s3().PutObjectCommand)({ Bucket: bucket, Key: key, Body: body, ContentType: mime, ContentLength: body.length, CacheControl: CACHE }));
    },
    /** { size, mime } or null when the object does not exist. */
    async head(key) {
      try {
        const out = await connection().send(new (s3().HeadObjectCommand)({ Bucket: bucket, Key: key }));
        return { size: Number(out.ContentLength), mime: String(out.ContentType || '').split(';')[0].trim().toLowerCase() };
      } catch (error) {
        if (error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404) return null;
        throw error;
      }
    },
    /** First `length` bytes, used to check the real type of a direct upload. */
    async getRange(key, length) {
      const out = await connection().send(new (s3().GetObjectCommand)({ Bucket: bucket, Key: key, Range: `bytes=0-${length - 1}` }));
      return Buffer.from(await out.Body.transformToByteArray());
    },
    async remove(key) { await connection().send(new (s3().DeleteObjectCommand)({ Bucket: bucket, Key: key })); },
    /** Presigned PUT: the type and the exact length are part of the signature, so the client cannot change them. */
    presignPut(key, mime, size) {
      return sign(connection(), new (s3().PutObjectCommand)({ Bucket: bucket, Key: key, ContentType: mime, ContentLength: size }), { expiresIn: UPLOAD_EXPIRES, signableHeaders: new Set(['content-type', 'content-length']) });
    },
  };
}

/**
 * @param db       the database (metadata rows; bytes too, only without R2)
 * @param options  env, storage (R2 adapter or null = database fallback), download (external fetcher), dryRun (compute URLs, write nothing)
 */
function createMedia(db, { env = process.env, storage = createR2Storage(env), download = downloadRemote, dryRun = false } = {}) {
  const limits = limitsOf(env);
  const saved = new Set();
  const remoteCache = new Map(); // url -> Promise<media URL>: an external image is downloaded once per process
  const stats = { stored: 0, downloaded: 0 };

  /**
   * THE single function that stores media. `body` = file bytes, `mime` = verified type. Content-addressed, so storing the
   * same bytes twice is free and every migration step is idempotent.
   */
  async function storeMedia({ body, mime }) {
    if (!EXT[mime]) throw fail(400, 'UNSUPPORTED_MEDIA');
    const id = idOf(body), name = `${id}.${EXT[mime]}`;
    if (dryRun || saved.has(id)) return PREFIX + name;
    const existing = (await db.query('SELECT storage FROM media WHERE id=$1', [id]))[0];
    if (storage) {
      if (existing?.storage !== 'r2') {
        await storage.put(keyOf(name), body, mime);
        await db.query("INSERT INTO media(id,mime,data,body,size,storage,created_at) VALUES($1,$2,'',NULL,$3,'r2',$4) ON CONFLICT (id) DO UPDATE SET storage='r2', size=EXCLUDED.size", [id, mime, body.length, Date.now()]);
        stats.stored++;
      }
    } else if (!existing) {
      // Fallback without R2: raw bytes (BYTEA), never base64 text.
      await db.query("INSERT INTO media(id,mime,data,body,size,storage,created_at) VALUES($1,$2,'',$3,$4,'db',$5) ON CONFLICT (id) DO NOTHING", [id, mime, body, body.length, Date.now()]);
      stats.stored++;
    }
    saved.add(id);
    return PREFIX + name;
  }

  /** A `data:` URL from an upload: decoded, its real type checked, then stored. */
  async function storeDataUrl(value, { svg = true } = {}) {
    const match = DATA_URL.exec(value);
    const declared = match[1].toLowerCase();
    const body = Buffer.from(value.slice(match[0].length), 'base64');
    const kind = kindOf(declared);
    if (!kind || !body.length) throw fail(400, 'INVALID_MEDIA');
    if (body.length > limits[kind]) throw fail(413, 'MEDIA_TOO_LARGE');
    let mime;
    try { mime = verifyMedia(body, declared, kind); } catch { throw fail(400, 'INVALID_MEDIA'); }
    if (mime === 'image/svg+xml' && !svg) throw fail(400, 'INVALID_MEDIA');
    return storeMedia({ body, mime });
  }

  /**
   * Raw bytes from the admin (database mode, where there is no presigned upload): a video or a large picture sent as the request
   * body. The real type is checked from the bytes. Without R2 the database holds the file, so a lower cap applies.
   */
  async function storeRaw(body, declared) {
    const mime = String(declared || '').split(';')[0].trim().toLowerCase();
    const kind = mime === 'image/svg+xml' ? '' : kindOf(mime);
    if (!kind || !body.length) throw fail(400, 'INVALID_MEDIA');
    if (body.length > rawLimit(kind)) throw fail(413, 'MEDIA_TOO_LARGE');
    let actual;
    try { actual = verifyMedia(body, mime, kind); } catch { throw fail(400, 'INVALID_MEDIA'); }
    return storeMedia({ body, mime: actual });
  }
  const rawLimit = kind => (storage ? limits[kind] : Math.min(limits[kind], mb(env.MEDIA_MAX_DB_MB, 25)));

  /** Copies an external https image into storage once and returns its /api/media URL. */
  function importRemote(url, { kind = 'image' } = {}) {
    const cacheKey = `${kind}:${url}`;
    if (!remoteCache.has(cacheKey)) {
      const job = (async () => {
        const file = await download(url, { kind, maxBytes: kind === 'video' ? limits.video : Math.min(limits.image, 10 * 1024 * 1024) });
        stats.downloaded++;
        return storeMedia(file);
      })();
      job.catch(() => remoteCache.delete(cacheKey)); // failures may be retried later
      remoteCache.set(cacheKey, job);
    }
    return remoteCache.get(cacheKey);
  }

  /**
   * Returns a copy of `value` where every inline data URL (anywhere) and every external https picture (under a media key)
   * is replaced by its /api/media URL.
   *  options.remote: 'strict' (default) = a failed download rejects the save; 'lenient' = transient failures keep the URL;
   *                  'report' = any failure keeps the URL (client data: a finished AI render is never lost); 'skip' = no download.
   *  options.known:  strings already stored in this row: kept as they are (only NEW external URLs are downloaded on save).
   *  options.videos: also copy external videos (`{ type: 'video', uri }`), used by the migration script.
   *  options.svg:    allow SVG uploads (admin content only).
   */
  async function externalize(value, { remote = 'strict', videos = false, svg = true, known, onError } = {}) {
    let changed = false;
    const visit = async (node, key, parent) => {
      if (typeof node === 'string') {
        if (DATA_URL.test(node)) { changed = true; return storeDataUrl(node, { svg }); }
        const absolute = ABSOLUTE.exec(node);
        if (absolute) { changed = true; return absolute[1]; }
        // Unchanged URLs already in the row are left to the migration script, so an unrelated edit (or a reorder burst) never waits on downloads.
        if (remote !== 'skip' && MEDIA_KEYS.has(key) && /^https?:\/\//i.test(node) && !known?.has(node)) {
          const isVideo = key === 'uri' && parent?.type === 'video';
          if (isVideo && !videos) return node;
          try {
            const url = await importRemote(node, { kind: isVideo ? 'video' : 'image' });
            changed = true;
            return url;
          } catch (error) {
            onError?.(node, error);
            if (remote === 'report' || (remote === 'lenient' && !error.policy)) return node;
            throw fail(error.policy ? 400 : 502, `MEDIA_URL_${error.code || 'FAILED'}`);
          }
        }
        return node;
      }
      if (Array.isArray(node)) { const out = []; for (const child of node) out.push(await visit(child, key, parent)); return out; }
      if (node && typeof node === 'object') {
        const out = {};
        // Sequential on purpose: bounded memory and at most one download at a time per request.
        for (const [childKey, child] of Object.entries(node)) out[childKey] = await visit(child, childKey, node);
        return out;
      }
      return node;
    };
    const result = await visit(value, '', null);
    return { value: result, changed };
  }

  /** THE single read function. `name` = `<hash>.<ext>`. Returns { redirect } | { mime, body } | null when unknown. */
  async function readMedia(name) {
    const match = NAME.exec(String(name || ''));
    if (!match) return null;
    const row = (await db.query('SELECT mime,storage,data,body FROM media WHERE id=$1', [match[1]]))[0];
    if (!row || MIME[match[2]] !== row.mime) return null;
    if (row.storage === 'r2') return storage ? { redirect: storage.publicUrl(keyOf(match[0])), mime: row.mime } : null;
    if (row.storage !== 'db') return null; // pending direct upload
    if (row.body) return { mime: row.mime, body: Buffer.from(row.body) };
    if (row.data) return { mime: row.mime, body: Buffer.from(row.data, 'base64') }; // legacy base64 row (read-only)
    return null;
  }

  /** Step 1 of a direct upload (admin only, checked by the caller). The server picks the key; type and size are signed. */
  async function presignUpload({ contentType, size }) {
    if (!storage) throw fail(503, 'R2_NOT_CONFIGURED');
    const mime = String(contentType || '').toLowerCase();
    const kind = mime === 'image/svg+xml' ? '' : kindOf(mime);
    if (!kind) throw fail(400, 'UNSUPPORTED_MEDIA_TYPE');
    if (!Number.isSafeInteger(size) || size < 1) throw fail(400, 'INVALID_SIZE');
    if (size > limits[kind]) throw fail(413, 'MEDIA_TOO_LARGE');
    const id = crypto.randomBytes(16).toString('hex'), name = `${id}.${EXT[mime]}`;
    await db.query("INSERT INTO media(id,mime,data,body,size,storage,created_at) VALUES($1,$2,'',NULL,$3,'pending',$4)", [id, mime, size, Date.now()]);
    const uploadUrl = await storage.presignPut(keyOf(name), mime, size);
    return { id, uploadUrl, method: 'PUT', headers: { 'Content-Type': mime }, url: PREFIX + name, expiresIn: UPLOAD_EXPIRES, maxBytes: limits[kind] };
  }

  /** Step 2: verifies what actually arrived in R2 (size, type, magic bytes) and publishes it. */
  async function completeUpload(id) {
    if (!storage) throw fail(503, 'R2_NOT_CONFIGURED');
    if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) throw fail(400, 'INVALID_ID');
    const row = (await db.query('SELECT mime,size,storage,created_at FROM media WHERE id=$1', [id]))[0];
    if (!row) throw fail(404, 'NOT_FOUND');
    const name = `${id}.${EXT[row.mime]}`;
    if (row.storage === 'r2') return { url: PREFIX + name };
    if (row.storage !== 'pending' || Number(row.created_at) < Date.now() - PENDING_TTL) throw fail(410, 'UPLOAD_EXPIRED');
    const object = await storage.head(keyOf(name));
    if (!object) throw fail(409, 'UPLOAD_MISSING');
    const reject = async code => { await storage.remove(keyOf(name)).catch(() => {}); await db.query("DELETE FROM media WHERE id=$1 AND storage='pending'", [id]); throw fail(400, code); };
    if (object.size !== Number(row.size) || object.mime !== row.mime) return reject('UPLOAD_MISMATCH');
    try { verifyMedia(await storage.getRange(keyOf(name), 64), row.mime, kindOf(row.mime)); } catch { return reject('INVALID_MEDIA'); }
    await db.query("UPDATE media SET storage='r2' WHERE id=$1", [id]);
    return { url: PREFIX + name };
  }

  /**
   * Migration helper: copies one legacy database row (base64 `data` or `body` bytes) to R2 and marks it as stored there.
   * The database copy is left untouched (nothing is ever deleted).
   */
  async function moveRowToR2(row) {
    if (!storage) throw fail(503, 'R2_NOT_CONFIGURED');
    const body = row.body ? Buffer.from(row.body) : Buffer.from(row.data || '', 'base64');
    if (!body.length || !EXT[row.mime]) return false;
    const name = `${row.id}.${EXT[row.mime]}`;
    if (dryRun) return true;
    const object = await storage.head(keyOf(name));
    if (!object || object.size !== body.length) await storage.put(keyOf(name), body, row.mime);
    await db.query("UPDATE media SET storage='r2', size=$2 WHERE id=$1", [row.id, body.length]);
    return true;
  }

  return { storeMedia, storeRaw, rawLimit, readMedia, externalize, importRemote, presignUpload, completeUpload, moveRowToR2, stats, mode: storage ? 'r2' : 'database' };
}

module.exports = { createMedia, createR2Storage, r2Status, MEDIA_PREFIX: PREFIX, MEDIA_KEYS, R2_VARS, EXT };
