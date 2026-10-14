/* Repeatable production measurements: 3 cold mobile runs, 4x CPU slowdown.
 * Usage: node scripts/audit-performance.js > performance.json (serve dist first).
 * Local assets only: third-party image availability must not skew CPU comparisons.
 */
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const zlib = require('node:zlib');
async function main() {
  const browser = await chromium.launch();
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.route('**/*', route => new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort());
    const session = await context.newCDPSession(page);
    await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.addInitScript(() => {
      window.audit = { cls: 0, longTasks: 0, lcp: 0 };
      new PerformanceObserver(list => list.getEntries().forEach(e => { if (!e.hadRecentInput) window.audit.cls += e.value; })).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver(list => list.getEntries().forEach(e => { window.audit.longTasks += e.duration; })).observe({ type: 'longtask', buffered: true });
      new PerformanceObserver(list => list.getEntries().forEach(e => { window.audit.lcp = e.startTime; })).observe({ type: 'largest-contentful-paint', buffered: true });
    });
    await page.goto(process.env.TEST_URL || 'http://localhost:4173');
    await page.getByTestId('global-search-open').waitFor();
    const ready = await page.evaluate(() => performance.now());
    await page.waitForTimeout(1500);
    const metrics = await page.evaluate(() => ({
      ...window.audit,
      paints: performance.getEntriesByType('paint').map(e => ({ name: e.name, ms: e.startTime })),
      fonts: performance.getEntriesByType('resource').filter(e => /\.(ttf|woff2)/.test(e.name)).map(e => ({ name: e.name.split('/').pop(), bytes: e.decodedBodySize })),
      scriptBytes: performance.getEntriesByType('resource').filter(e => /\.js/.test(e.name)).reduce((n, e) => n + e.decodedBodySize, 0),
    }));
    const start = Date.now();
    await page.getByTestId('global-search-open').click();
    await page.getByTestId('global-search-input').waitFor();
    runs.push({ ready, searchMs: Date.now() - start, ...metrics });
    await context.close();
  }
  const bundles = fs.readdirSync('dist/_expo/static/js/web').filter(f => f.endsWith('.js')).map(file => {
    const data = fs.readFileSync(`dist/_expo/static/js/web/${file}`);
    return { file, bytes: data.length, gzip: zlib.gzipSync(data).length };
  });
  console.log(JSON.stringify({ methodology: '3 cold mobile runs; 4x CPU; local assets; no network throttling', runs, bundles }, null, 2));
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
