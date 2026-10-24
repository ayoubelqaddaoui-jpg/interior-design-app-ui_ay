const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const shell = require('../src/lib/loaderShell.js');

const read = file => fs.readFileSync(file, 'utf8');
const list = source => [...source.matchAll(/'([a-z]+)'/g)].map(match => match[1]);
const MOROCCAN = ['zellige', 'arch', 'lantern', 'mosaic'];
/** The CSS class each Moroccan SVG animates. */
const ANIMATED = { zellige: '.db-za', arch: '.db-arch path', lantern: '.db-lantern', mosaic: '.db-mosaic polygon' };

test('every loader style exists in the types, the admin list, the web shell, the native renderer and all three languages', () => {
  const inType = list(read('src/data/types.ts').match(/export type LoaderStyle = ([^;]+);/)[1]);
  const inAdmin = list(read('src/lib/boot.ts').match(/LOADER_STYLES: LoaderStyle\[\] = \[([^\]]+)\]/)[1]);
  assert.deepEqual(inAdmin, inType);
  for (const style of MOROCCAN) assert(inType.includes(style), `${style} is selectable`);
  const builtIn = inType.filter(style => style !== 'custom');
  assert.deepEqual(Object.keys(shell.MARKUP).sort(), [...builtIn].sort(), 'web markup for every built-in style');
  const native = read('src/components/BootLoader.tsx');
  for (const style of builtIn.filter(style => style !== 'ring')) assert(native.includes(`config.style === '${style}'`), `native renderer draws ${style}`);
  const texts = read('src/i18n/locales/improvements.ts');
  assert.equal(inType.every(style => (texts.match(new RegExp(`"loader_${style}":`, 'g')) || []).length === 3), true, 'fr, ar and dar labels');
});

test('Moroccan loaders are inline SVG (counts for first paint), themeable and need no external file', () => {
  for (const style of MOROCCAN) {
    const markup = shell.MARKUP[style];
    assert.match(markup, /^<svg /, `${style} is SVG`);
    assert(markup.includes('currentColor'), `${style} follows the loader colour`);
    assert.doesNotMatch(markup, /https?:|href=|<script|<image|on[a-z]+=/i, `${style} is self-contained`);
    assert(markup.length < 1800, `${style} stays tiny (${markup.length} bytes)`);
    const rule = shell.CSS.split('}').find(part => part.includes(ANIMATED[style] + '{'));
    assert(rule && /animation:/.test(rule), `${style} has animation rules`);
    for (const klass of (markup.match(/class="(db-[a-z]+)"/g) || []).slice(1).map(match => match.slice(7, -1))) assert(shell.CSS.includes(klass), `${klass} is styled`);
  }
  assert(shell.CSS.includes('prefers-reduced-motion'), 'reduced motion is respected');
  assert(shell.CSS.length < 6000, 'the shell CSS stays small');
});

test('the head script renders a Moroccan style, remembers it, and an unknown style falls back to the ring', () => {
  const nodes = () => { const box = { style: {}, innerHTML: '', textContent: '', appendChild() {} }; return box; };
  for (const style of [...MOROCCAN, 'ring']) {
    const box = nodes();
    shell.render(box, { style, color: '#112233' });
    assert.equal(box.innerHTML, shell.MARKUP[style]);
    assert.equal(box.style.color, '#112233');
  }
  const fallback = nodes();
  shell.render(fallback, { style: 'does-not-exist', color: 'red' });
  assert.equal(fallback.innerHTML, shell.MARKUP.ring);
  assert.equal(fallback.style.color, '#111111', 'an invalid colour is ignored');
  assert.match(shell.headScript({ enabled: true, style: 'lantern' }), /zellige/, 'the inline head script knows the new styles');
});
test('postexport inlines the shell and the saved style is applied from the settings document', () => {
  const post = read('scripts/postexport.js');
  assert(post.includes('loader.headScript') && post.includes('loader.CSS'));
  assert(post.includes("style:st.loaderStyle||'ring'"));
});
