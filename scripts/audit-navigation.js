/* Production route/interaction comparison; run against either pre-change or current build. */
const { chromium } = require('@playwright/test');
const base = process.env.TEST_URL || 'http://localhost:4173';
async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('dialog', dialog => dialog.accept());
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('dwira:v1:lang', JSON.stringify('fr'));
    localStorage.setItem('dwira:v1:local', JSON.stringify({ adminSession: true }));
  });
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const routes = [];
  await page.goto(`${base}/admin`);
  await page.getByTestId('range-90').waitFor();
  for (let round = 0; round < 3; round++) {
    for (const route of ['tabs', 'tools', 'sections', 'roomTypes', 'palettes', 'models', 'users', 'theme', 'interface']) {
      const start = await page.evaluate(id => { const start = performance.now(); document.querySelector(`[data-testid="nav-${id}"]`).click(); return start; }, route);
      await page.waitForFunction(path => location.pathname === `/admin/${path}` && !!document.querySelector(`[data-testid="${path === 'users' ? 'admin-back' : path === 'theme' ? 'theme-light' : path === 'interface' ? 'interface-submit' : 'crud-add'}"]`), route);
      const ms = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(performance.now()))));
      routes.push({ route, round, ms: Math.round(ms - start) });
    }
  }
  await page.goto(`${base}/admin/tools`);
  await page.getByTestId('edit-tool_interior').waitFor();
  const start = await page.evaluate(() => { const start = performance.now(); document.querySelector('[data-testid="edit-tool_interior"]').click(); return start; });
  await page.getByTestId('lt-title-fr').waitFor();
  const editMs = await page.evaluate(() => performance.now()) - start;
  await page.getByTestId('lt-title-fr').fill('Performance draft');
  const close = await page.evaluate(() => { const start = performance.now(); document.querySelector('[data-testid="sheet-close"]').click(); return start; });
  await page.getByTestId('unsaved-save').waitFor();
  const dialogMs = await page.evaluate(() => performance.now()) - close;
  await page.getByTestId('unsaved-discard').click();
  await page.goto(base);
  await page.getByTestId('tool-tool_interior').waitFor();
  const tabs = [];
  for (const route of ['explore', 'history', 'assistant', 'index']) {
    const start = await page.evaluate(id => { const start = performance.now(); document.querySelector(`[data-testid="tab-${id}"]`).click(); return start; }, route);
    await page.waitForFunction(path => location.pathname === (path === 'index' ? '/' : `/${path}`), route);
    const end = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(performance.now()))));
    tabs.push({ route, ms: Math.round(end - start) });
  }
  console.log(JSON.stringify({ methodology: 'desktop; 4x CPU; third-party media blocked; event-to-route-control plus next frame; three admin rounds (cold then warm)', routes, tabs, editMs: Math.round(editMs), dialogMs: Math.round(dialogMs) }, null, 2));
  await browser.close();
}
main().catch(error => { console.error(error); process.exit(1); });
