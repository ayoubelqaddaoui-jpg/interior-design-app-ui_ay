/** Contrast report for the 20 presets: `npm run check:themes` (fails when a text/background pair is below WCAG AA). */
import { PRESETS } from '../src/theme/presets';
import { ratio } from '../src/theme/color';

const PAIRS: [string, string, string, number][] = [
  ['fg', 'bg', 'Body text on page', 4.5],
  ['fg', 'surface', 'Body text on card', 4.5],
  ['fg', 'surface2', 'Body text on chips', 4.5],
  ['muted', 'bg', 'Muted text on page', 4.5],
  ['muted', 'surface', 'Muted text on card', 4.5],
  ['muted', 'surface2', 'Muted text on chips', 4.5],
  ['onprimary', 'primary', 'Text on accent buttons', 4.5],
  ['onink', 'ink', 'Text on ink buttons', 4.5],
  ['fg', 'soft', 'Text on soft tint', 4.5],
  ['primary', 'bg', 'Accent vs page (decorative, text on it is checked above)', 1.3],
  ['ink', 'bg', 'Ink vs page (selected states)', 3],
  ['line', 'bg', 'Border vs page', 1.1],
];
let bad = 0;
for (const p of PRESETS) {
  const t = p.tokens as any;
  const fails = PAIRS.filter(([a, b, , min]) => ratio(t[a], t[b]) < min);
  const worst = Math.min(...PAIRS.slice(0, 9).map(([a, b]) => ratio(t[a], t[b])));
  console.log(`${fails.length ? 'FAIL' : ' ok '}  ${p.id.padEnd(11)} ${p.category.padEnd(11)} worst text contrast ${worst.toFixed(1)}`);
  fails.forEach(([a, b, label, min]) => { bad++; console.log(`        - ${label}: ${a} ${t[a]} on ${b} ${t[b]} = ${ratio(t[a], t[b]).toFixed(2)} (< ${min})`); });
}
console.log(`\n${PRESETS.length} presets, ${bad} issue(s)`);
process.exit(bad ? 1 : 0);
