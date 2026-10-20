const crypto = require('node:crypto');
const webpush = require('web-push');
const TEXT = {
  en: { title: 'New demand', open: 'Open', call: 'Call' },
  fr: { title: 'Nouvelle demande', open: 'Ouvrir', call: 'Appeler' },
  ar: { title: 'طلب جديد', open: 'فتح', call: 'اتصال' },
  dar: { title: 'طلب جديد', open: 'فتح', call: 'اتصال' },
};
const trim = (value, max) => Array.from(String(value ?? '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim()).slice(0, max).join('');
const phone = value => trim(value, 32).replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
const locale = value => Object.hasOwn(TEXT, value) ? value : 'en';
function payloadFor(request, language) {
  const lang = locale(language), text = TEXT[lang];
  return {
    title: text.title, body: `${trim(request.name, 80)} - ${phone(request.whatsapp)}`,
    requestId: request.id, phone: phone(request.whatsapp), lang,
    dir: lang === 'ar' || lang === 'dar' ? 'rtl' : 'ltr',
    url: `/admin/requests?target=${encodeURIComponent(request.id)}&open=${encodeURIComponent(request.id)}`,
    actions: [{ action: 'open', title: text.open }, { action: 'call', title: text.call }],
  };
}
function validateSubscription(input) {
  const lang = locale(input?.language);
  if (input?.kind === 'fcm') {
    const token = input.token;
    if (typeof token !== 'string' || token.length < 20 || token.length > 4096 || !/^[A-Za-z0-9_:\-]+$/.test(token)) throw new Error('Invalid FCM token');
    return { id: crypto.createHash('sha256').update(token).digest('hex'), kind: 'fcm', token, language: lang };
  }
  const value = input?.subscription;
  let endpoint;
  try { endpoint = new URL(value.endpoint); } catch { throw new Error('Invalid subscription'); }
  // Restrict outgoing requests to the browsers' push services (prevents SSRF).
  const allowed = host => ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(host)
    || host.endsWith('.push.services.mozilla.com') || host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com');
  if (endpoint.protocol !== 'https:' || !allowed(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.port || endpoint.href.length > 2048) throw new Error('Invalid push provider');
  const keys = value.keys;
  if (!keys || !['p256dh', 'auth'].every(key => typeof keys[key] === 'string' && /^[A-Za-z0-9_-]+$/.test(keys[key]))) throw new Error('Invalid keys');
  if (Buffer.from(keys.p256dh, 'base64url').length !== 65 || Buffer.from(keys.auth, 'base64url').length !== 16) throw new Error('Invalid key length');
  return { id: crypto.createHash('sha256').update(endpoint.href).digest('hex'), kind: 'web', subscription: { endpoint: endpoint.href, keys: { p256dh: keys.p256dh, auth: keys.auth } }, language: lang };
}

/** FCM HTTP v1 without firebase-admin: service-account JWT -> OAuth token -> REST send. */
function createFcm(json, fetchImpl = fetch) {
  let account, cached;
  const parse = () => account ||= JSON.parse(json);
  async function accessToken() {
    if (cached && cached.expires > Date.now() + 60000) return cached.token;
    const key = parse(), now = Math.floor(Date.now() / 1000);
    const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3300 })}`;
    const assertion = `${unsigned}.${crypto.createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url')}`;
    const response = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
    if (!response.ok) throw Object.assign(new Error('FCM auth failed'), { statusCode: response.status });
    const body = await response.json();
    cached = { token: body.access_token, expires: Date.now() + (body.expires_in || 3300) * 1000 };
    return cached.token;
  }
  return async (token, payload) => {
    const response = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${parse().project_id}/messages:send`, {
      method: 'POST', headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token, notification: { title: payload.title, body: payload.body },
        data: { url: payload.url, phone: payload.phone, requestId: payload.requestId, categoryId: 'demands', language: payload.lang },
        android: { priority: 'HIGH', ttl: '86400s', notification: { channel_id: 'demands', tag: payload.requestId } } } }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const status = body.error?.details?.find(detail => detail.errorCode)?.errorCode || body.error?.status;
      throw Object.assign(new Error('FCM send failed'), { statusCode: response.status, code: status === 'UNREGISTERED' || status === 'INVALID_ARGUMENT' ? 'messaging/registration-token-not-registered' : status });
    }
  };
}

/**
 * VAPID keys come from the environment when provided. Otherwise they are generated once and stored in the
 * database so the "Notifications" button works on a fresh deployment with zero configuration.
 */
async function loadVapid(db, env) {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || 'mailto:admin@example.com' };
  const read = async () => (await db.query("SELECT value FROM settings WHERE key='vapid'"))[0];
  let row = await read();
  if (!row) {
    const keys = webpush.generateVAPIDKeys();
    await db.query("INSERT INTO settings VALUES('vapid',$1) ON CONFLICT (key) DO NOTHING", [JSON.stringify(keys)]);
    row = await read(); // a concurrent cold start may have won the race: always use the stored winner
  }
  const keys = JSON.parse(row.value);
  return { ...keys, subject: env.VAPID_SUBJECT || 'mailto:admin@example.com' };
}

function createNotifier(db, env, adapters = {}) {
  let vapid;
  const keys = async () => vapid ||= await loadVapid(db, env);
  const fcmSender = adapters.fcm || (env.FCM_SERVICE_ACCOUNT_JSON ? createFcm(env.FCM_SERVICE_ACCOUNT_JSON) : null);
  const subscriptions = async () => (await db.query('SELECT data FROM subscriptions')).map(row => JSON.parse(row.data));
  const remove = id => db.query('DELETE FROM subscriptions WHERE id=$1', [id]);
  async function deliver(request, completed = []) {
    const done = new Set(completed);
    let retry = false;
    const { publicKey, privateKey, subject } = await keys();
    // Independent sends: one expired/failed device never suppresses the others.
    await Promise.all((await subscriptions()).filter(row => !done.has(row.id)).map(async subscriber => {
      const payload = payloadFor(request, subscriber.language);
      try {
        if (subscriber.kind === 'fcm') {
          if (!fcmSender) throw Object.assign(new Error('FCM is not configured'), { code: 'fcm-unconfigured' });
          await fcmSender(subscriber.token, payload);
        } else {
          await (adapters.web || ((sub, body, options) => webpush.sendNotification(sub, body, { ...options, vapidDetails: { subject, publicKey, privateKey } })))(subscriber.subscription, JSON.stringify(payload), { TTL: 86400, urgency: 'high', timeout: 8000 });
        }
        done.add(subscriber.id);
      } catch (error) {
        const expired = error.statusCode === 410 || error.statusCode === 404 || error.code === 'messaging/registration-token-not-registered';
        if (expired) { await remove(subscriber.id); done.add(subscriber.id); } else retry = true;
        // Never log tokens, endpoints, payloads, names or phone numbers.
        console.warn('Demand push failed', { code: error.statusCode || error.code || 'delivery-failed' });
      }
    }));
    return { retry, completed: [...done] };
  }
  return {
    deliver,
    config: async () => ({ publicKey: (await keys()).publicKey, web: true, android: !!fcmSender }),
    save: async subscriber => { await db.query('INSERT INTO subscriptions VALUES($1,$2) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data', [subscriber.id, JSON.stringify(subscriber)]); },
    remove,
    count: async () => (await db.query('SELECT COUNT(*)::int AS n FROM subscriptions'))[0].n,
  };
}
module.exports = { createNotifier, createFcm, payloadFor, validateSubscription, trim, phone };
