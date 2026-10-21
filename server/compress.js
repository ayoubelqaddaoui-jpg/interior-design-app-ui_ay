/** Brotli/gzip for text responses. Hosts like Vercel do this themselves; the plain Node server and local previews do not. */
const zlib = require('node:zlib');
const fs = require('node:fs');

const TEXT = /^(text\/|application\/(json|javascript|manifest\+json)|image\/svg)/;
const cache = new Map(); // `${file}:${mtime}:${encoding}` -> Buffer (static assets are immutable, compress once)

/** Best encoding the client accepts, or '' for none. */
function pick(req) {
  const accepted = String(req.headers['accept-encoding'] || '');
  if (/\bbr\b/.test(accepted)) return 'br';
  if (/\bgzip\b/.test(accepted)) return 'gzip';
  return '';
}
const squeeze = (buffer, encoding, level) => encoding === 'br'
  ? zlib.brotliCompressSync(buffer, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: level, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buffer.length } })
  : zlib.gzipSync(buffer, { level: 9 });

/** Sends `body` compressed when it is text, large enough to matter, and the client supports it. */
function sendBuffer(req, res, status, headers, body) {
  const encoding = pick(req);
  const type = String(headers['Content-Type'] || '');
  if (!encoding || body.length < 1024 || !TEXT.test(type)) { res.writeHead(status, { ...headers, 'Content-Length': body.length }); return res.end(req.method === 'HEAD' ? undefined : body); }
  const packed = squeeze(body, encoding, 5); // API responses: fast level
  res.writeHead(status, { ...headers, 'Content-Encoding': encoding, 'Content-Length': packed.length, Vary: 'Accept-Encoding' });
  res.end(req.method === 'HEAD' ? undefined : packed);
}

/** Streams a static file, compressing text files once at the best level and reusing the result. */
function sendFile(req, res, file, headers) {
  const type = String(headers['Content-Type'] || '');
  const encoding = pick(req);
  const stat = fs.statSync(file);
  if (!encoding || stat.size < 1024 || !TEXT.test(type)) {
    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    return req.method === 'HEAD' ? res.end() : fs.createReadStream(file).pipe(res);
  }
  const key = `${file}:${stat.mtimeMs}:${encoding}`;
  let packed = cache.get(key);
  // Compressed at build time by scripts/postexport.js: nothing to compute while a visitor waits.
  const ready = encoding === 'br' ? `${file}.br` : '';
  if (!packed && ready && fs.existsSync(ready) && fs.statSync(ready).mtimeMs >= stat.mtimeMs) { packed = fs.readFileSync(ready); cache.set(key, packed); }
  if (!packed) { packed = squeeze(fs.readFileSync(file), encoding, 11); cache.set(key, packed); }
  res.writeHead(200, { ...headers, 'Content-Encoding': encoding, 'Content-Length': packed.length, Vary: 'Accept-Encoding' });
  res.end(req.method === 'HEAD' ? undefined : packed);
}

module.exports = { sendBuffer, sendFile };
