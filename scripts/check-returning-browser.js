/* Run against demo export first; then a backend export with EXPO_PUBLIC_API_URL=/api.
 * TEST_URL=... TEST_BACKEND=1 node scripts/check-returning-browser.js
 * Uses existing login/claim/upgrade paths, not an injected admin session.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { chromium, expect } = require('@playwright/test');
const backend = process.env.TEST_BACKEND === '1';
const base = process.env.TEST_URL || (backend ? 'http://localhost:8080' : 'http://localhost:4173');
const readTS = file => {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports });
  return module.exports;
};
const texts = readTS('src/i18n/locales/returning.ts').returningTexts;
const nav = readTS('src/lib/adminNav.ts').ADMIN_NAV;
for (const lang of ['dar', 'ar', 'fr']) assert.deepEqual(Object.keys(texts[lang]).sort(), Object.keys(texts.fr).sort());
const visible = (page, id) => page.locator(`[data-testid="${id}"]:visible`).last();
async function login(page) {
  await visible(page, 'admin-email').fill(backend ? 'preview@example.com' : 'admin@dwira.app');
  await visible(page, 'admin-password').fill(backend ? 'preview-password-only' : 'admin123');
  await visible(page, 'admin-signin').click();
  await visible(page, 'returning-add').waitFor();
}
async function main() {
  const browser = await chromium.launch({ headless: true });
  const errors = [], apiCalls = [];
  let count = 0;
  try {
    for (const lang of ['fr', 'ar', 'dar']) for (const size of ['desktop', 'mobile']) for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: size === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: size === 'mobile', hasTouch: size === 'mobile' });
      await context.addInitScript(({ lang, theme }) => {
        if (localStorage.getItem('returning-seeded')) return;
        localStorage.setItem('dwira:v1:lang', JSON.stringify(lang));
        localStorage.setItem('dwira:v1:doc:theme', JSON.stringify({ active: theme, custom: {} }));
        localStorage.setItem('returning-seeded', '1');
      }, { lang, theme });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) apiCalls.push(r.url()); });
      try {
        await page.goto(base + '/admin/returning');
        await visible(page, 'admin-signin').waitFor();
        await login(page);
        if (backend) {
          assert.equal((await context.request.patch(base + '/api/admin/returning', { data: { versions: [] } })).status(), 200);
          await page.reload(); await visible(page, 'returning-add').waitFor();
        } else await expect(visible(page, 'returning-demo-note')).toHaveText(texts[lang].connect);
        await visible(page, 'returning-add').click();
        await visible(page, 'returning-enabled').click();
        await visible(page, 'returning-weight').fill('100');
        for (const language of ['dar', 'ar', 'fr']) {
          await visible(page, `returning-lang-${language}`).click();
          await visible(page, 'returning-headline').fill(`<b>${language} {name}</b>`);
          await visible(page, 'returning-body').fill(`${language} {price} {remaining}`);
          for (let i = 0; i < 4; i++) await visible(page, `returning-benefit-${i}`).fill(`${language} benefit ${i}`);
          await expect(page.getByTestId(`returning-preview-${language}`)).toContainText(`${language} ${language === 'fr' ? 'Samira' : 'سميرة'}`);
          assert.equal(await page.getByTestId(`returning-preview-${language}`).evaluate(el => getComputedStyle(el).direction), language === 'fr' ? 'ltr' : 'rtl');
        }
        await visible(page, 'returning-save').click();
        await expect(visible(page, 'returning-save')).toBeDisabled();
        let versions = backend ? await (await context.request.get(base + '/api/admin/returning')).json() : await page.evaluate(() => JSON.parse(localStorage.getItem('dwira:v1:returning-versions')));
        assert.equal(versions.length, 1);
        const id = versions[0].id;
        assert(!versions[0].texts.fr.headline.includes('<'));
        assert.equal(versions[0].texts.dar.benefits.length, 4);
        await visible(page, 'returning-duplicate').click();
        await visible(page, 'returning-delete').click();
        await page.getByText(texts[lang].delete, { exact: true }).waitFor();
        const cancel = page.getByText(readTS(`src/i18n/locales/${lang}.ts`).default.common.cancel, { exact: true }).last();
        await cancel.click();
        await expect(visible(page, 'returning-select-B')).toBeVisible();
        await visible(page, 'returning-delete').click();
        await page.getByText(readTS(`src/i18n/locales/${lang}.ts`).default.common.delete, { exact: true }).last().click();
        await expect(visible(page, 'returning-select-B')).toHaveCount(0);
        await page.reload();
        await visible(page, 'returning-select-A').waitFor();
        await expect(visible(page, 'returning-headline')).toHaveValue('dar {name}');
        for (const device of ['mobile', 'desktop']) {
          await visible(page, `returning-device-${device}`).click();
          for (const language of ['dar', 'ar', 'fr']) {
            const box = await page.getByTestId(`returning-preview-${language}`).boundingBox();
            assert(box.x >= -1 && box.x + box.width <= (size === 'mobile' ? 390 : 1440) + 1);
          }
        }
        await page.screenshot({ path: `.pw/returning-${backend ? 'backend' : 'demo'}-${lang}-${size}-${theme}.png` });
        // Dirty editor still uses the shared unsaved navigation guard.
        await visible(page, 'returning-headline').fill('Unsaved editor');
        if (size === 'mobile') await visible(page, 'admin-menu-btn').click();
        await visible(page, 'nav-dashboard').click();
        await visible(page, 'unsaved-message').waitFor();
        await visible(page, 'unsaved-cancel').click();
        await expect(visible(page, 'returning-headline')).toHaveValue('Unsaved editor');
        if (size === 'mobile' && await visible(page, 'admin-menu-close').isVisible()) await visible(page, 'admin-menu-close').click();
        await visible(page, 'returning-discard').click();
        // All admin pages smoke check with a real login, once per mode.
        if (count === 0) for (const item of nav) {
          await page.goto(base + item.href);
          await visible(page, 'logout').waitFor();
          await page.waitForTimeout(120);
          assert.equal(await visible(page, 'admin-signin').count(), 0, item.href);
        }
        // Existing free generation server flow, then logout/login with the same canonical phone.
        if (backend) {
          const phone = `+2127${String(Date.now()).slice(-6)}${String(count).padStart(2, '0')}`;
          assert.equal((await context.request.post(base + '/api/user/login', { data: { name: 'Samira', phone } })).status(), 200);
          const signal = await (await context.request.post(base + '/api/user/image', { headers: { 'Content-Type': 'image/png', 'X-Device-ID': 'e'.repeat(64) }, data: fs.readFileSync('assets/favicon.png') })).json();
          assert.equal((await context.request.post(base + '/api/user/claim', { data: { id: `returning-claim-${Date.now()}-${count}`, uploadId: signal.uploadId } })).status(), 200);
          await context.request.post(base + '/api/user/logout', { data: {} });
          await context.request.post(base + '/api/user/login', { data: { name: 'Samira', phone: '00' + phone.slice(1) } });
        }
        await page.goto(base + '/pro?generation=1');
        await visible(page, 'returning-popup').waitFor();
        if (backend) {
          await expect(visible(page, `returning-preview-${lang}`)).toContainText(`${lang} Samira`);
          await expect.poll(async () => (await (await context.request.get(base + '/api/admin/returning/results')).json()).find(row => row.id === id).views).toBe(1);
        } else {
          await expect(visible(page, `returning-preview-${lang}`)).not.toContainText(`${lang} benefit`);
          await expect(visible(page, `returning-preview-${lang}`)).toContainText('149 MAD');
        }
        await page.screenshot({ path: `.pw/returning-popup-${backend ? 'backend' : 'demo'}-${lang}-${size}-${theme}.png` });
        await visible(page, `returning-primary-${lang}`).click();
        await expect(visible(page, 'returning-popup')).toHaveCount(0);
        await visible(page, 'pro-cta').click();
        if (backend) {
          await expect.poll(async () => (await (await context.request.get(base + '/api/admin/returning/results')).json()).find(row => row.id === id).purchases).toBe(1);
          const row = (await (await context.request.get(base + '/api/admin/returning/results')).json()).find(row => row.id === id);
          assert.equal(row.clicks, 1); assert.equal(row.views, 1);
          await page.goto(base + '/admin/returning');
          await visible(page, 'returning-from').fill('2099-01-01');
          await visible(page, 'returning-to').fill('2099-12-31');
          await visible(page, 'returning-filter').click();
          await expect(visible(page, 'returning-result-A')).toContainText(`${texts[lang].views}: 0`);
          await visible(page, 'returning-enabled').click(); await visible(page, 'returning-save').click();
          await expect(visible(page, 'returning-save')).toBeDisabled();
          await page.goto(base + '/pro?generation=1'); await visible(page, 'returning-popup').waitFor();
          await expect(visible(page, `returning-preview-${lang}`)).not.toContainText(`${lang} benefit`);
          await visible(page, `returning-later-${lang}`).click();
          await expect(page).toHaveURL(base + '/');
        }
        await page.goto(base + '/admin/returning'); await visible(page, 'returning-add').waitFor();
        if (size === 'mobile') await visible(page, 'admin-menu-btn').click();
        await visible(page, 'logout').click(); await visible(page, 'admin-signin').waitFor();
        if (backend) {
          assert.equal((await context.request.get(base + '/api/admin/session')).status(), 401);
          assert.equal((await context.request.get(base + '/api/user/session')).status(), 200);
        }
        console.log(`PASS ${backend ? 'backend' : 'demo'} ${lang}/${size}/${theme}: actual admin login/logout, editor, RTL previews, persistence, popup${backend ? ', funnel/results' : ', zero API requests'}`);
        count++;
      } catch (error) {
        await page.screenshot({ path: `.pw/returning-failure-${backend ? 'backend' : 'demo'}.png` });
        console.error({ lang, size, theme, url: page.url(), body: (await page.locator('body').innerText()).slice(-2500) });
        throw error;
      } finally { await context.close(); }
    }
    assert.deepEqual(errors, []);
    if (!backend) assert.deepEqual(apiCalls, [], 'Demo mode must not call any API');
    console.log(`PASS ${count} combinations; all admin pages opened; no browser exceptions.`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exit(1); });
