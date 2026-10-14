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
  // Restrict outgoing requests to known browser push providers, preventing SSRF.
  const hosts = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
  if (endpoint.protocol !== 'https:' || !hosts.includes(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.port || endpoint.href.length > 2048) throw new Error('Invalid push provider');
  const keys = value.keys;
  if (!keys || !['p256dh', 'auth'].every(key => typeof keys[key] === 'string' && /^[A-Za-z0-9_-]+$/.test(keys[key]))) throw new Error('Invalid keys');
  if (Buffer.from(keys.p256dh, 'base64url').length !== 65 || Buffer.from(keys.auth, 'base64url').length !== 16) throw new Error('Invalid key length');
  return { id: crypto.createHash('sha256').update(endpoint.href).digest('hex'), kind: 'web', subscription: { endpoint: endpoint.href, keys: { p256dh: keys.p256dh, auth: keys.auth } }, language: lang };
}
function createNotifier(store, env, adapters = {}) {
  const configured = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
  if (configured) webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  let fcm;
  async function sendFCM(token, payload) {
    if (!env.FCM_SERVICE_ACCOUNT_JSON) throw new Error('FCM is not configured');
    if (!fcm) {
      const { initializeApp, cert } = require('firebase-admin/app');
      const { getMessaging } = require('firebase-admin/messaging');
      const app = initializeApp({ credential: cert(JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON)) }, 'dwira-notifications');
      fcm = getMessaging(app);
    }
    return fcm.send({ token, notification: { title: payload.title, body: payload.body },
      data: { url: payload.url, phone: payload.phone, requestId: payload.requestId, categoryId: 'demands', language: payload.lang },
      android: { priority: 'high', ttl: 86400000, notification: { channelId: 'demands', tag: payload.requestId } },
    });
  }
  async function deliver(request, completed = []) {
    const subscriptions = (await store.read()).subscriptions;
    const done = new Set(completed);
    let retry = false;
    // Send independently: one expired/failed device must never suppress other devices.
    for (const subscriber of subscriptions) {
      if (done.has(subscriber.id)) continue;
      const payload = payloadFor(request, subscriber.language);
      try {
        if (subscriber.kind === 'fcm') await (adapters.fcm || sendFCM)(subscriber.token, payload);
        else {
          if (!configured && !adapters.web) throw new Error('VAPID is not configured');
          await (adapters.web || webpush.sendNotification.bind(webpush))(subscriber.subscription, JSON.stringify(payload), { TTL: 86400, urgency: 'high', timeout: 5000 });
        }
        done.add(subscriber.id);
      } catch (error) {
        const expired = error.statusCode === 410 || error.statusCode === 404 || ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(error.code);
        if (expired) {
          await store.mutate(data => { data.subscriptions = data.subscriptions.filter(row => row.id !== subscriber.id); });
          done.add(subscriber.id);
        } else retry = true;
        // Never log tokens, endpoint URLs, payloads, names or phone numbers.
        console.warn('Demand push failed', { code: error.statusCode || error.code || 'delivery-failed' });
      }
    }
    return { retry, completed: [...done] };
  }
  return { deliver, publicConfig: { publicKey: configured ? env.VAPID_PUBLIC_KEY : null, web: configured, android: !!env.FCM_SERVICE_ACCOUNT_JSON } };
}
module.exports = { createNotifier, payloadFor, validateSubscription, trim, phone };
