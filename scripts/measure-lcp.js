#!/usr/bin/env node
/**
 * Repeatable first-load measurement (cold cache each run): LCP, FCP, bytes and requests on emulated mobile 4G.
 *
 *   node scripts/measure-lcp.js [url] [--runs=3] [--images=block|allow] [--cpu=4] [--db-delay=0]
 *
 * Defaults to http://localhost:8080 (start the app first: `STATIC_DIR=dist PGLITE_DIR=:memory: node server/index.js`).
 * Network profile = Lighthouse "Slow 4G"-style mobile throttling (1.6 Mbit/s down, 750 kbit/s up, 150 ms RTT), CPU x4.
 * `--images=block` removes third-party image variance (measures the app itself); `allow` fetches real images over the
 * throttled link. It is a LAB measurement from this machine: use PageSpeed Insights for the real, field-like figure.
 */
const { chromium } = require('@playwright/test');
const args = process.argv.slice(2);
const opt = (name, def) => (args.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1] ?? def;
const url = args.find(a => /^https?:/.test(a)) || 'http://localhost:8080';
const runs = Number(opt('runs', 3));
const images = opt('images', 'block');
const cpu = Number(opt('cpu', 4));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function once(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 13; Moto G Power) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  const own = new URL(url).host;
  if (images === 'block') await page.route('**/*', route => (route.request().resourceType() === 'image' && new URL(route.request().url()).host !== own ? route.abort() : route.continue()));
  const requests = [];
  page.on('response', async response => { try { const length = Number(response.headers()['content-length'] || 0); requests.push({ url: response.url(), status: response.status(), length, type: response.request().resourceType() }); } catch { /* ignore */ } });
  await page.addInitScript(() => {
    window.__m = { lcp: 0, lcpEl: '', lcpUrl: '', cls: 0, spinnerGoneAt: 0 };
    new PerformanceObserver(list => { for (const e of list.getEntries()) { window.__m.lcp = e.startTime; window.__m.lcpEl = e.element ? e.element.tagName : ''; window.__m.lcpUrl = e.url || ''; } }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(list => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__m.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto(url, { waitUntil: 'commit' });
  await page.getByTestId('global-search-open').waitFor({ timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const m = await page.evaluate(() => ({ ...window.__m, fcp: (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime || 0, hasTool: !!document.querySelector('[data-testid^="tool-"]'), spinner: !!document.querySelector('[role="progressbar"]') }));
  const total = requests.reduce((n, r) => n + r.length, 0);
  const js = requests.filter(r => r.type === 'script').reduce((n, r) => n + r.length, 0);
  await context.close();
  return { ...m, requests: requests.length, bytes: total, jsBytes: js, apiCalls: requests.filter(r => /\/api\//.test(r.url)).length };
}
(async () => {
  const browser = await chromium.launch();
  const all = [];
  for (let i = 0; i < runs; i++) all.push(await once(browser));
  await browser.close();
  process.stderr.write(JSON.stringify(all.map(r => ({ lcp: Math.round(r.lcp), fcp: Math.round(r.fcp), hasTool: r.hasTool, spinner: r.spinner, el: r.lcpEl }))) + "\n");
  const pick = key => Math.round(median(all.map(r => r[key])));
  console.log(JSON.stringify({ url, images, runs, note: 'lab measurement, emulated Slow-4G + 4x CPU from this machine', median: { lcpMs: pick('lcp'), fcpMs: pick('fcp'), cls: Number(median(all.map(r => r.cls)).toFixed(4)), transferredBytes: pick('bytes'), jsBytes: pick('jsBytes'), requests: pick('requests'), apiCalls: pick('apiCalls') }, lcpElement: all.map(r => r.lcpEl + ' ' + (r.lcpUrl || '').slice(0, 70)), toolCardsRendered: all.every(r => r.hasTool), runsRaw: all.map(r => ({ lcp: Math.round(r.lcp), fcp: Math.round(r.fcp) })) }, null, 2));
})().catch(error => { console.error(error); process.exit(1); });
