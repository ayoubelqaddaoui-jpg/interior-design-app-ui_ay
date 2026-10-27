import { useSyncExternalStore } from 'react';
import { api, backendEnabled } from '@/lib/backend';
import { useLocal } from '@/store/useLocal';
import { useStore } from '@/store/useStore';
import type { Lang, LText } from '@/data/types';

/**
 * Automatic translation of multilingual admin fields (Darija / Arabic / French) through the server's free, keyless providers
 * (POST /api/admin/translate). It can be switched off in Admin > Interface > Automatic translation (`settings.autoTranslate`).
 */
export const LANGS: Lang[] = ['dar', 'ar', 'fr'];
const ARABIC = /[\u0600-\u06FF\u0750-\u077F]/g;
const LATIN = /[A-Za-z\u00C0-\u024F]/g;
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

/** Which language a text is really written in: its script wins over the box it was typed in (French typed in the Darija box is French). */
export function detectSource(text: string, typedIn: Lang): Lang {
  const arabic = count(text, ARABIC), latin = count(text, LATIN);
  if (latin > arabic) return 'fr';
  if (arabic > latin) return typedIn === 'fr' ? 'ar' : typedIn;
  return typedIn;
}

/** True when the switch is on and this device can actually reach the admin API (an offline demo admin cannot). */
export const autoTranslateAvailable = () => backendEnabled && useLocal.getState().adminSession && !useLocal.getState().adminOffline;
export const useAutoTranslate = () => {
  const on = useStore((s) => s.doc.settings.autoTranslate !== false);
  const session = useLocal((s) => s.adminSession && !s.adminOffline);
  return backendEnabled && on && session;
};

interface Answer { translations: Partial<Record<Lang, string[]>>; provider: Partial<Record<Lang, string>> }
/** Translates `texts` written in `from` into the `to` languages. Languages the providers could not produce are missing from the result. */
export async function translateTexts(from: Lang, texts: string[], to: Lang[]): Promise<Partial<Record<Lang, string[]>>> {
  const answer = await api<Answer>('/admin/translate', { method: 'POST', body: { from, to, texts } });
  return answer.translations ?? {};
}

/** Translations still travelling (or about to start): Save waits for them so a half-translated form is never stored. */
let pending = 0;
const watchers = new Set<() => void>();
const notify = () => watchers.forEach((w) => w());
export function beginTranslation() {
  pending++; notify();
  let done = false;
  return () => { if (!done) { done = true; pending--; notify(); } };
}
export const translationsIdle = () => new Promise<void>((resolve) => {
  if (!pending) return resolve();
  const check = () => { if (!pending) { watchers.delete(check); resolve(); } };
  watchers.add(check);
});
export const usePendingTranslations = () => useSyncExternalStore((cb) => { watchers.add(cb); return () => { watchers.delete(cb); }; }, () => pending, () => 0);

/** Fills the empty languages of a whole list of texts at once (batch "paste titles"): one request, copy fallback per language. */
export async function translateLines(lines: string[]): Promise<LText[]> {
  const fallback = lines.map((line) => ({ dar: line, ar: line, fr: line }) as LText);
  if (!autoTranslateAvailable() || !lines.length) return fallback;
  // Group by detected language so each group is one request.
  const groups = new Map<Lang, number[]>();
  lines.forEach((line, i) => { const from = detectSource(line, 'fr'); groups.set(from, [...(groups.get(from) ?? []), i]); });
  const out = fallback.map((value) => ({ ...value }));
  await Promise.all([...groups].map(async ([from, indexes]) => {
    try {
      const result = await translateTexts(from, indexes.map((i) => lines[i]), LANGS.filter((l) => l !== from));
      for (const lang of LANGS) if (lang !== from) result[lang]?.forEach((text, k) => { out[indexes[k]][lang] = text; });
      indexes.forEach((i) => { out[i][from] = lines[i]; });
    } catch { /* the copy fallback stays */ }
  }));
  return out;
}
