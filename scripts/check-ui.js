/* Production-export regression checks. Start npm run serve:web before running. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { chromium } = require('@playwright/test');

const base = process.env.TEST_URL || 'http://localhost:4173';
const reorder = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/reorder.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, reorder);
const move = (ids, dir) => Array.from(reorder.exports.moveSelection('abcde'.split('').map((id) => ({ id })), ids, dir), (row) => row.id).join('');
assert.equal(move(['b', 'c'], -1), 'bcade');
assert.equal(move(['b', 'c'], 1), 'adbce');
assert.equal(move(['a', 'b'], -1), 'abcde');
assert.equal(move(['d', 'e'], 1), 'abcde');
assert.equal(move(['b', 'd'], -1), 'badce');
assert.equal(move(['b', 'd'], 1), 'acbed');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('test-initialized')) {
      localStorage.setItem('dwira:v1:lang', JSON.stringify('fr'));
      localStorage.setItem('dwira:v1:local', JSON.stringify({ adminSession: true }));
      localStorage.setItem('test-initialized', 'yes');
    }
  });
  const go = async (path, id) => { await page.goto(`${base}${path}`); if (id) await page.getByTestId(id).first().waitFor(); };
  const saved = (key) => page.evaluate((key) => JSON.parse(localStorage.getItem(`dwira:v1:${key}`)), key);
  const seed = async (key, value) => { await page.evaluate(({ key, value }) => localStorage.setItem(`dwira:v1:${key}`, JSON.stringify(value)), { key, value }); };

  await go('/', 'brand-mark');
  assert.match(await page.getByTestId('brand-mark').innerText(), /Dwira/);
  // Check actual muted looping playback on the reported Home staging card.
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await go('/', 'tool-tool_staging');
    await page.getByTestId('tool-tool_staging').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => { const v = document.querySelector('[data-testid="tool-tool_staging"] video'); return v && !v.paused && v.currentTime > 0.1 && v.muted && v.playsInline && v.loop; }, null, { timeout: 20000 });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await go('/admin/branding', 'brand-save');
  await page.getByTestId('chip-image').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByText('Importer une image', { exact: true }).click();
  await (await chooser).setFiles('assets/favicon.png');
  await page.waitForFunction(() => Array.from(document.querySelectorAll('input')).some((el) => el.value === '(uploaded image)'));
  await page.getByTestId('brand-save').click();
  await page.waitForTimeout(300);
  assert.match((await saved('doc:branding')).logoUri, /^data:image\/png;base64,/);
  await go('/', 'brand-mark');
  await page.waitForFunction(() => { const img = document.querySelector('[data-testid="brand-mark"] img'); return img && img.complete && img.naturalWidth > 0; });
  // Check image mode and physical placement on desktop and phones.
  const png = 'data:image/png;base64,' + fs.readFileSync('assets/favicon.png').toString('base64');
  for (const lang of ['fr', 'ar']) {
    await seed('lang', lang);
    for (const width of [1440, 320, 375, 430]) {
    await page.setViewportSize({ width, height: 900 });
    for (const position of ['left', 'center', 'right']) {
      await seed('doc:branding', { appName: 'Dwira', logoMode: 'image', logoUri: png, logoPosition: position });
      await go('/', 'brand-mark');
      const mark = await page.getByTestId('brand-mark').boundingBox();
      const header = await page.getByTestId(`brand-header-${position}`).boundingBox();
      assert(mark && header && mark.width > 0 && mark.height > 0);
      assert(mark.x >= header.x - 1 && mark.x + mark.width <= header.x + header.width + 1);
      if (position === 'center') assert(Math.abs((mark.x + mark.width / 2) - (header.x + header.width / 2)) < 2);
    }
  }
  }
  await seed('lang', 'fr');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seed('doc:branding', { appName: 'Dwira', logoMode: 'text', logoUri: png, logoPosition: 'left', logoFont: 'Lora', logoColor: '#2563EB' });
  await go('/', 'brand-mark');
  assert.match(await page.getByTestId('brand-mark').innerText(), /Dwira/);
  await go('/admin/interface', 'bulk-enable-tabs');
  await page.getByTestId('chip-Inter').click();
  await page.getByTestId('chip-Tajawal').click();
  await page.getByTestId('bulk-enable-tabs').click();
  await page.waitForTimeout(300);
  const settings = await saved('doc:settings');
  assert.equal(settings.frenchFont, 'Inter');
  assert.equal(settings.arabicFont, 'Tajawal');
  assert(settings.bulkPanels.includes('tabs'));
  await go('/admin/tabs', 'crud-batch-add');
  await page.getByTestId('crud-batch-add').click();
  await page.getByTestId('lt-title-fr').nth(0).fill('Regression A');
  await page.getByTestId('lt-title-fr').nth(1).fill('Regression B');
  await page.getByTestId('batch-save').click();
  await page.getByTestId('batch-save').waitFor({ state: 'hidden' });
  let tabs = await saved('tabs');
  const added = tabs.filter((row) => row.title.fr.startsWith('Regression'));
  assert.equal(added.length, 2);
  assert.notEqual(added[0].order, added[1].order);
  for (const row of added) await page.getByTestId(`select-${row.id}`).click();
  await page.getByTestId('crud-batch-edit').click();
  await page.getByTestId('batch-field-title').click();
  await page.getByTestId('lt-title-fr').fill('Regression edited');
  await page.getByTestId('batch-save').click();
  await page.getByTestId('batch-save').waitFor({ state: 'hidden' });
  tabs = await saved('tabs');
  assert.equal(tabs.filter((row) => row.title.fr === 'Regression edited').length, 2);
  for (const row of added) await page.getByTestId(`select-${row.id}`).click();
  await page.getByTestId('crud-batch-move--1').click();
  await page.waitForTimeout(300);
  tabs = (await saved('tabs')).sort((a, b) => a.order - b.order);
  assert.deepEqual(tabs.slice(-3, -1).map((row) => row.id), added.map((row) => row.id));
  await page.getByTestId('crud-batch-delete').click();
  await page.getByText('Supprimer', { exact: true }).last().click();
  await page.waitForTimeout(300);
  assert.equal((await saved('tabs')).filter((row) => added.some((a) => a.id === row.id)).length, 0);

  for (const width of [280, 320, 360, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await go('/admin/theme', 'theme-light');
    const cards = await page.locator('[data-testid^="theme-"][role="radio"]').all();
    const first = await cards[0].boundingBox();
    const second = await cards[1].boundingBox();
    assert(Math.abs(first.y - second.y) < 2, `Theme cards wrapped at ${width}px`);
    assert(first.width > 60 && second.width > 60);
  }
  for (const width of [320, 1440]) {
  await page.setViewportSize({ width, height: 1000 });
  for (const entity of ['tabs', 'tools', 'sections', 'categories', 'inspirations', 'styles', 'roomTypes', 'palettes', 'models']) {
    await go(`/admin/${entity}`, 'crud-add');
    await page.getByTestId('crud-add').click();
    await page.waitForFunction(() => { const button = document.querySelector('[data-testid="form-save"]'); const bounds = button?.getBoundingClientRect(); return bounds && bounds.top >= 0 && bounds.bottom <= window.innerHeight; });
    const save = await page.getByTestId('form-save').boundingBox();
    assert(save && save.y >= 0 && save.y + save.height <= 1000, `Save hidden in ${entity} form`);
    await page.getByText('Annuler', { exact: true }).last().click();
  }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const layout of ['grid', 'masonry', 'editorial', 'carousel']) {
    await seed('doc:settings', { ...settings, galleryLayout: layout });
    await go('/explore');
    const category = page.locator('[data-testid^="cat-"]').first();
    await category.waitFor();
    await category.click();
    await page.locator('[data-testid^="ins-"]').first().waitFor();
    if (layout !== 'carousel') await page.getByTestId(`gallery-${layout}`).waitFor();
    else await page.getByTestId('carousel-next').first().waitFor();
  }
  await go('/explore');
  const next = page.getByTestId('carousel-next').first();
  await next.waitFor();
  await next.click();
  await page.waitForTimeout(500);
  assert.equal(await page.getByTestId('carousel-previous').first().getAttribute('aria-disabled'), null);
  assert.deepEqual(errors, []);
  console.log('PASS: ordering, actual uploaded logos, muted card autoplay, LTR/RTL branding positions, fonts, bulk add/edit/move/delete, mobile themes, desktop/mobile content forms, gallery modes and desktop sliders');
  await browser.close();
}
main().catch((error) => { console.error(error); process.exit(1); });
