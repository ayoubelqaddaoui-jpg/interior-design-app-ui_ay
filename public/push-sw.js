/* Push-only worker: deliberately does not intercept fetch or cache private app/admin data. */
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
function safeUrl(value) {
  try {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin && url.pathname === '/admin/requests' ? url.href : new URL('/admin/requests', self.location.origin).href;
  } catch { return new URL('/admin/requests', self.location.origin).href; }
}
self.addEventListener('push', event => {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  if (!payload || typeof payload.title !== 'string' || typeof payload.body !== 'string') return;
  const phone = String(payload.phone || '').replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '').slice(0, 32);
  const actions = Array.isArray(payload.actions) ? payload.actions.filter(action => ['open', 'call'].includes(action.action) && typeof action.title === 'string').slice(0, 2).map(action => ({ action: action.action, title: action.title.slice(0, 40) })) : [];
  event.waitUntil(self.registration.showNotification(payload.title.slice(0, 120), {
    body: payload.body.slice(0, 220), icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', vibrate: [200, 100, 200], renotify: true, requireInteraction: false,
    tag: `demand-${String(payload.requestId).slice(0, 100)}`, lang: payload.lang || 'en', dir: payload.dir === 'rtl' ? 'rtl' : 'ltr',
    actions, data: { url: safeUrl(payload.url), phone },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil((async () => {
    const url = new URL(safeUrl(data.url));
    const phone = String(data.phone || '').replace(/[^\d+]/g, '').slice(0, 32);
    if (event.action === 'call' && /^\+?\d{6,20}$/.test(phone)) {
      try { const opened = await self.clients.openWindow(`tel:${phone}`); if (opened) return; } catch { /* Chrome may disallow tel: directly from a worker. */ }
      url.searchParams.set('call', phone);
    }
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.focus();
      // Let the app's unsaved-change guard handle navigation rather than destroying a draft.
      existing.postMessage({ type: 'dwira:notification-open', url: url.pathname + url.search });
      return;
    }
    return self.clients.openWindow(url.href);
  })());
});
