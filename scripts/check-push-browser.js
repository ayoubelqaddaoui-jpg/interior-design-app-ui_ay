/* Real app -> real HTTP backend -> durable demand -> encrypted captured provider payload.
 * Browser subscription/provider transport are test doubles; CDP injects a real worker push event.
 * This is NOT proof of delivery through Google or an Android OS notification tray.
 * Start scripts/push-fixture-server.js with .pw/push-dist built using EXPO_PUBLIC_API_URL=/api.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { chromium } = require('@playwright/test');
const base = 'http://localhost:8080';
async function main() {
  const browser = await chromium.launch();
  const errors = [];
  for (const [lang, viewport] of [['fr', { width: 1440, height: 1000 }], ['ar', { width: 390, height: 844 }], ['dar', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, permissions: ['notifications'] });
    const ec = crypto.createECDH('prime256v1'); ec.generateKeys();
    const fake = { endpoint: `https://fcm.googleapis.com/fcm/send/test-${crypto.randomUUID()}`, keys: { p256dh: ec.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
    await context.addInitScript(({ lang, fake }) => {
      localStorage.setItem('dwira:v1:lang', JSON.stringify(lang));
      const construct = value => ({ endpoint: value.endpoint, options: { applicationServerKey: new Uint8Array(value.key || []).buffer }, toJSON: () => ({ endpoint: value.endpoint, keys: value.keys }), unsubscribe: async () => { localStorage.removeItem('test-subscription'); return true; } });
      PushManager.prototype.subscribe = async function(options) { const value = { ...fake, key: Array.from(new Uint8Array(options.applicationServerKey)) }; localStorage.setItem('test-subscription', JSON.stringify(value)); return construct(value); };
      PushManager.prototype.getSubscription = async function() { const value = localStorage.getItem('test-subscription'); return value ? construct(JSON.parse(value)) : null; };
    }, { lang, fake });
    const admin = await context.newPage();
    admin.on('pageerror', error => errors.push(error.message));
    await admin.goto(`${base}/admin/requests`);
    await admin.getByTestId('admin-email').fill('browser-test@example.com');
    await admin.getByTestId('admin-password').fill('browser-test-password-only');
    await admin.getByTestId('admin-signin').click();
    await admin.getByTestId('push-enable').waitFor();
    await admin.getByTestId('push-enable').click();
    await admin.getByTestId('push-disable').waitFor();
    const sub = await admin.evaluate(() => navigator.serviceWorker.ready.then(worker => worker.pushManager.getSubscription()).then(sub => sub.toJSON()));
    assert.equal(sub.endpoint, fake.endpoint);
    const state = JSON.parse(await fs.readFile('.pw/e2e-state.json', 'utf8'));
    assert(state.subscriptions.some(subscriber => subscriber.subscription.endpoint === fake.endpoint && subscriber.language === lang));
    await admin.close();
    // Submit from a completely separate client session, through the actual wizard and lead form.
    const clientContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await clientContext.addInitScript(() => localStorage.setItem('dwira:v1:lang', JSON.stringify('fr')));
    const client = await clientContext.newPage();
    client.on('pageerror', error => errors.push(error.message));
    await client.goto(base);
    await client.getByTestId('tool-tool_interior').click();
    await client.getByTestId('add-photo').click();
    const chooser = client.waitForEvent('filechooser');
    await client.getByTestId('pick-gallery').click();
    await (await chooser).setFiles('assets/favicon.png');
    await client.getByTestId('remove-photo').waitFor();
    await client.getByTestId('wizard-continue').click();
    await client.locator('[data-testid^="room-room_"]').first().click();
    await client.getByTestId('wizard-continue').click();
    await client.locator('[data-testid^="style-style_"]').first().click();
    await client.getByTestId('wizard-continue').click();
    await client.waitForTimeout(300);
    if (await client.getByTestId('wizard-continue').count()) await client.getByTestId('wizard-continue').click();
    await client.getByTestId('lead-name').fill(`  Chrome ${lang} Test  `);
    await client.getByTestId('lead-phone').fill('+212612345678');
    await client.getByTestId('lead-submit').click();
    let captured;
    for (let i = 0; i < 100; i++) {
      captured = JSON.parse(await fs.readFile('.pw/push-captured.json', 'utf8')).find(row => row.payload.body === `Chrome ${lang} Test - +212612345678` && row.payload.lang === lang);
      if (captured) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(captured, 'Submitting the lead form did not produce a push payload');
    assert(captured.encryptedBytes > 0);
    const persisted = JSON.parse(await fs.readFile('.pw/e2e-state.json', 'utf8'));
    assert(persisted.requests.some(row => row.id === captured.payload.requestId && row.name === `Chrome ${lang} Test`));
    // No app page is open in this admin context while the worker is delivered a push event.
    const inspector = await context.newPage();
    const cdp = await context.newCDPSession(inspector);
    let registrations = [];
    cdp.on('ServiceWorker.workerRegistrationUpdated', event => { registrations.push(...event.registrations); });
    await cdp.send('ServiceWorker.enable');
    for (let i = 0; i < 50 && !registrations.some(reg => reg.scopeURL === `${base}/`); i++) await new Promise(resolve => setTimeout(resolve, 50));
    const registration = registrations.find(reg => reg.scopeURL === `${base}/` && !reg.isDeleted);
    assert(registration, 'Push worker was not registered');
    await cdp.send('ServiceWorker.deliverPushMessage', { origin: base, registrationId: registration.registrationId, data: JSON.stringify(captured.payload) });
    await inspector.goto(`${base}/admin/requests`);
    const displayed = await inspector.evaluate(async () => { const worker = await navigator.serviceWorker.ready; const notifications = await worker.getNotifications(); return notifications.map(n => ({ title: n.title, body: n.body, actions: n.actions, data: n.data })); });
    const notification = displayed.find(n => n.body === captured.payload.body);
    assert(notification, 'Browser notification API did not retain the name/phone notification');
    assert.equal(notification.title, lang === 'fr' ? 'Nouvelle demande' : 'طلب جديد');
    assert.deepEqual(notification.actions.map(action => action.action), ['open', 'call']);
    await inspector.goto(`${base}${captured.payload.url}`);
    await inspector.getByTestId('req-wa').waitFor();
    assert((await inspector.locator('body').innerText()).includes(`Chrome ${lang} Test`));
    assert((await inspector.locator('body').innerText()).includes('+212612345678'));
    await inspector.getByTestId('sheet-close').click();
    await inspector.getByTestId('push-disable').click();
    await inspector.getByTestId('push-disable').waitFor({ state: 'hidden' });
    assert(!JSON.parse(await fs.readFile('.pw/e2e-state.json', 'utf8')).subscriptions.some(subscriber => subscriber.subscription?.endpoint === fake.endpoint));
    await clientContext.close();
    await context.close();
  }
  assert.deepEqual(errors, []);
  await browser.close();
  console.log('PASS: real lead submission, backend login, durable demands/subscriptions, encrypted captured provider payload, actual service-worker display via CDP, name/phone and actions, demand deep links and disable in desktop + mobile-sized Chrome (fr/ar/dar). Live Google transport/physical Android remain manual.');
}
main().catch(error => { console.error(error); process.exit(1); });
