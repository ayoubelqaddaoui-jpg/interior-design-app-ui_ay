// Request recorder + normaliser + differ shared by the contract scenarios.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const TOKEN = /\b[a-f0-9]{64}\b/g;
const MEDIA = /\/api\/media\/([a-f0-9]{32})\.([a-z0-9]+)/g;
const TS_KEY = /(^|[a-z])(At|Seen)$|^(createdAt|updatedAt|lastSeen|expiresAt|nextAt)$/;

function makeNormaliser() {
  const maps = { u: new Map(), t: new Map(), m: new Map() };
  const id = (map, prefix, value) => { if (!map.has(value)) map.set(value, `<${prefix}${map.size + 1}>`); return map.get(value); };
  const str = s => s.replace(MEDIA, (_, h, ext) => `/api/media/${id(maps.m, "media", h)}.<ext>`).replace(UUID, v => id(maps.u, 'uuid', v)).replace(TOKEN, v => id(maps.t, 'token', v));
  const walk = (v, key = '') => {
    if (typeof v === 'string') return str(v);
    if (typeof v === 'number' && TS_KEY.test(key) && v > 1e11) return '<ts>';
    if (Array.isArray(v)) return v.map(x => walk(x, key));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  return { value: walk, text: str };
}

// Symfony appends `private` to a response that has no public/private directive. Next to `no-store` it changes nothing.
const directives = h => { const d = (h || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean); return (d.includes('no-store') ? d.filter(x => x !== 'private') : d).sort().join(', '); };
function cookie(h, norm) {
  if (!h) return h;
  const parts = h.split(';').map(x => x.trim());
  const [pair, ...attrs] = parts;
  const [name, value] = [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)];
  // Expires is derived from Max-Age by Symfony; browsers prefer Max-Age, so it is not part of the contract.
  return `${name}=${value && value !== 'deleted' ? norm.text(value) : ''}; ${attrs.filter(a => !/^expires=/i.test(a)).map(a => a.toLowerCase()).sort().join('; ')}`;
}

function recorder(base) {
  const norm = makeNormaliser();
  const log = [];
  async function call(name, method, path, { body, headers = {}, raw, ignore = [] } = {}) {
    const init = { method, headers: { ...headers }, redirect: 'manual' };
    if (raw !== undefined) init.body = raw;
    else if (body !== undefined) { init.body = typeof body === 'string' ? body : JSON.stringify(body); init.headers['content-type'] ??= 'application/json'; }
    if (/^(GET|HEAD)$/i.test(method)) delete init.body; // fetch() refuses it; the route must not care anyway
    const res = await fetch(base + path, init);
    const text = await res.text();
    let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    // Node's SELECT has no ORDER BY (Postgres heap order); Laravel orders by insertion sequence. Clients sort by `order`.
    if (json?.collections) for (const rows of Object.values(json.collections)) rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const h = n => res.headers.get(n);
    const entry = {
      name, status: res.status,
      // An empty 204 has no content type or caching meaning (PHP's built-in server adds text/html).
      type: res.status === 204 ? '' : (h('content-type') || '').split(';')[0],
      cache: res.status === 204 ? '' : directives(h('cache-control')),
      cookie: cookie(res.headers.getSetCookie?.()[0] ?? h('set-cookie'), norm),
      etag: h('etag') ? 'present' : undefined,
      nosniff: h('x-content-type-options'), referrer: h('referrer-policy'),
      acao: h('access-control-allow-origin'), acac: h('access-control-allow-credentials'),
      body: json !== undefined ? norm.value(json) : (text ? `<text ${text.length}>` : undefined),
      ignore,
    };
    log.push(entry);
    return { status: res.status, json, text, headers: res.headers };
  }
  return { call, log };
}

/** Deep diff -> list of "path: a != b". `ignore` entries are path prefixes ("body.runtime"). */
function diff(a, b, path = '', out = [], ignore = []) {
  if (ignore.some(p => path === p || path.startsWith(p + '.'))) return out;
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], path ? `${path}.${k}` : k, out, ignore);
    return out;
  }
  out.push(`${path}: node=${JSON.stringify(a)} laravel=${JSON.stringify(b)}`);
  return out;
}

function compare(node, laravel) {
  const problems = [];
  const n = Math.max(node.length, laravel.length);
  for (let i = 0; i < n; i++) {
    const a = node[i], b = laravel[i];
    if (!a || !b) { problems.push({ step: (a || b).name, list: ['missing step on one side'] }); continue; }
    const { ignore = [] } = a;
    const strip = ({ ignore: _i, name: _n, ...rest }) => rest;
    const list = diff(strip(a), strip(b), '', [], ignore);
    if (list.length) problems.push({ step: a.name, list });
  }
  return problems;
}
module.exports = { recorder, compare, diff };
