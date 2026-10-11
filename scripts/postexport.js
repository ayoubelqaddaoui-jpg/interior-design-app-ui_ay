#!/usr/bin/env node
/**
 * Vercel (and several other static hosts) never serve paths containing a `node_modules` segment.
 * `expo export -p web` places fonts/images from packages under `dist/assets/node_modules/...`,
 * which would 404 in production. This script moves them to `dist/assets/vendor/...` and rewrites
 * every reference in the exported HTML/JS/CSS.
 */
const fs = require('fs');
const path = require('path');

const dist = path.resolve(__dirname, '..', process.argv[2] || 'dist');
const from = path.join(dist, 'assets', 'node_modules');
const FROM = 'assets/node_modules';
const TO = 'assets/vendor';

if (!fs.existsSync(dist)) { console.error(`[postexport] ${dist} not found. Run "expo export -p web" first.`); process.exit(1); }

if (fs.existsSync(from)) {
  const to = path.join(dist, 'assets', 'vendor');
  fs.rmSync(to, { recursive: true, force: true });
  fs.renameSync(from, to);
  console.log(`[postexport] moved ${path.relative(process.cwd(), from)} -> ${path.relative(process.cwd(), to)}`);
}

let files = 0, refs = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.(js|css|html|json|map)$/.test(e.name)) continue;
    const src = fs.readFileSync(p, 'utf8');
    if (!src.includes(FROM)) continue;
    const n = src.split(FROM).length - 1;
    fs.writeFileSync(p, src.split(FROM).join(TO));
    files++; refs += n;
  }
})(dist);
console.log(`[postexport] rewrote ${refs} reference(s) in ${files} file(s)`);

// Safety net: fail the build if anything still points to a node_modules asset path.
let bad = 0;
(function check(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === 'node_modules') { console.error('[postexport] leftover folder', p); bad++; } else check(p); continue; }
    if (/\.(js|css|html)$/.test(e.name) && fs.readFileSync(p, 'utf8').includes('/node_modules/')) {
      // only flag asset URLs, not stack-trace / package strings
      if (/assets\/node_modules\//.test(fs.readFileSync(p, 'utf8'))) { console.error('[postexport] leftover asset ref in', p); bad++; }
    }
  }
})(dist);
if (bad) process.exit(1);
console.log('[postexport] OK - dist is safe to deploy on Vercel');
