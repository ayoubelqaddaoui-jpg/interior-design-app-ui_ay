import type { Lang, LText } from '@/data/types';

/**
 * Translation status of a multilingual text, computed from the text itself (nothing is stored), so it updates on every keystroke:
 *  - missing    : nothing typed
 *  - incomplete : something is there but it does not look translated yet: a copy of another language's text, or written in the
 *                 wrong script (Latin letters in an Arabic-script language, Arabic letters in French). Needs a look.
 *  - complete   : a real text in its own language (or text without letters, such as a number or a symbol)
 * Darija and Arabic share a script and are very often written the same, so an identical pair is NOT flagged between them.
 */
export type LangState = 'complete' | 'incomplete' | 'missing';
export type LangReason = 'copy' | 'script';
export interface LangInfo { state: LangState; reason?: LangReason; of?: Lang }

export const LANG_ORDER: Lang[] = ['dar', 'ar', 'fr'];
export const SEVERITY: Record<LangState, number> = { complete: 0, incomplete: 1, missing: 2 };

const ARABIC = /[\u0600-\u06FF\u0750-\u077F]/g;
const LATIN = /[A-Za-z\u00C0-\u024F]/g;
const norm = (s: string | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

export function langStates(value: Partial<LText> | undefined): Record<Lang, LangInfo> {
  const text = (l: Lang) => norm(value?.[l]);
  const out = {} as Record<Lang, LangInfo>;
  for (const lang of LANG_ORDER) {
    const own = text(lang);
    if (!own) { out[lang] = { state: 'missing' }; continue; }
    const arabic = count(own, ARABIC), latin = count(own, LATIN);
    if (!arabic && !latin) { out[lang] = { state: 'complete' }; continue; }
    // The French text is the reference: an Arabic-script text equal to it was copied, not translated.
    const copyOf: Lang | undefined = lang === 'fr' ? undefined : text('fr') === own ? 'fr' : undefined;
    if (copyOf) { out[lang] = { state: 'incomplete', reason: 'copy', of: copyOf }; continue; }
    const wrongScript = lang === 'fr' ? arabic > latin : latin > arabic;
    out[lang] = wrongScript ? { state: 'incomplete', reason: 'script' } : { state: 'complete' };
  }
  return out;
}

export const worst = (a: LangState, b: LangState): LangState => (SEVERITY[a] >= SEVERITY[b] ? a : b);

/** One state per language over several texts (all the multilingual fields of a record): the worst one wins. */
export function mergeStates(list: (Partial<LText> | undefined)[]): Record<Lang, LangState> {
  const out: Record<Lang, LangState> = { dar: 'complete', ar: 'complete', fr: 'complete' };
  for (const value of list) {
    const states = langStates(value);
    for (const lang of LANG_ORDER) out[lang] = worst(out[lang], states[lang].state);
  }
  return out;
}

/** The text from which an empty language can be filled: French first, then Arabic, then Darija. */
export function copySource(value: Partial<LText> | undefined, target: Lang): Lang | undefined {
  return (['fr', 'ar', 'dar'] as Lang[]).find((l) => l !== target && (value?.[l] ?? '').trim());
}

export const doneCount = (states: Record<Lang, LangState | LangInfo>) => LANG_ORDER.filter((l) => (typeof states[l] === 'string' ? states[l] : (states[l] as LangInfo).state) === 'complete').length;
