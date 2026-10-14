/* TEST FIXTURE ONLY. Real HTTP/persistence and encryption; push-provider transport is captured.
 * No production route exposes a test send endpoint. No real customer data should use this server.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const webpush = require('../server/node_modules/web-push');
const { createBackend } = require('../server');
async function main() {
  const keys = webpush.generateVAPIDKeys();
  const directory = path.resolve('.pw');
  await fs.mkdir(directory, { recursive: true });
  await fs.rm(path.join(directory, 'e2e-state.json'), { force: true });
  await fs.writeFile(path.join(directory, 'push-captured.json'), '[]');
  const salt = 'browser-test-salt';
  const env = { DATA_FILE: path.join(directory, 'e2e-state.json'), STATIC_DIR: path.join(directory, 'push-dist'), APP_ORIGINS: 'http://localhost:8080', COOKIE_SECURE: 'false', ADMIN_EMAIL: 'browser-test@example.com', ADMIN_PASSWORD_HASH: `${salt}:${crypto.scryptSync('browser-test-password-only', salt, 64).toString('hex')}`, VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:testing@example.com' };
  const backend = createBackend({ env, senders: { web: async (subscription, payload, options) => {
    const request = webpush.generateRequestDetails(subscription, payload, options);
    const rows = JSON.parse(await fs.readFile(path.join(directory, 'push-captured.json'), 'utf8'));
    rows.push({ payload: JSON.parse(payload), encryptedBytes: request.body.length });
    await fs.writeFile(path.join(directory, 'push-captured.json'), JSON.stringify(rows));
  } } });
  backend.server.listen(8080, '0.0.0.0', () => console.log('Notification test fixture listening on 8080 (stub provider, not live push delivery)'));
}
main().catch(error => { console.error(error.message); process.exit(1); });
