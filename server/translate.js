/**
 * Automatic translation of admin content between French (fr), Modern Standard Arabic (ar) and Moroccan Darija (dar).
 * Free, no API key:
 *  1. Pollinations text API (open LLM, anonymous tier). The only free option that really writes Darija: the prompt asks for the
 *     spoken Moroccan dialect in Arabic script, and for MSA / French in the same call, so one request fills every missing language.
 *  2. MyMemory (translation memory + MT, anonymous 5 000 chars/day). Fast, French <-> Arabic only: it has no Darija, so Darija falls
 *     back to its Arabic text (Darija and MSA are very often written alike; the admin can refine).
 * Every result is checked (right script, right number of items); a language the first provider got wrong is retried on the second.
 * `fetch` is injectable for tests.
 */
const LANGS = ['fr', 'ar', 'dar'];
const NAMES = {
  fr: 'French',
  ar: 'Modern Standard Arabic (Arabic script)',
  dar: 'Moroccan Darija: the spoken Moroccan Arabic dialect, written in Arabic script the way Moroccans actually say it (not formal Modern Standard Arabic; keep common French loanwords Moroccans use, e.g. salon, cuisine)',
};
const MAX_TEXTS = 60;
const MAX_TEXT = 1500;
const MAX_TOTAL = 12000;
const ARABIC = /[\u0600-\u06FF\u0750-\u077F]/g;
const LATIN = /[A-Za-z\u00C0-\u024F]/g;
const count = (s, re) => (s.match(re) ?? []).length;
const hasLetters = s => count(s, ARABIC) + count(s, LATIN) > 0;

const cache = new Map();
const CACHE_MAX = 600;
const remember = (key, value) => { if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value); cache.set(key, value); };

/** A translation is usable when it is non-empty and written in the script of its language (text without letters, such as a number, passes). */
function plausible(lang, source, out) {
  if (typeof out !== 'string' || !out.trim()) return false;
  if (!hasLetters(source)) return true;
  const arabic = count(out, ARABIC), latin = count(out, LATIN);
  return lang === 'fr' ? latin > arabic : arabic > latin;
}

async function timed(fetchImpl, url, options, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try { return await fetchImpl(url, { ...options, signal: controller.signal }); } finally { clearTimeout(timer); }
}

/** Provider 1: one LLM call returns { lang: [translations...] } for every wanted language. */
async function viaPollinations(fetchImpl, from, to, texts, ms) {
  const wanted = to.map(l => `"${l}" = ${NAMES[l]}`).join('; ');
  const body = {
    model: 'openai-fast',
    temperature: 0.2,
    reasoning_effort: 'low',
    messages: [
      { role: 'system', content: 'You are a professional translator for an interior-design app used in Morocco. Translate short UI labels and descriptions faithfully and naturally. Keep numbers, brand names and line breaks. Reply with ONLY a JSON object, no markdown, no explanation.' },
      { role: 'user', content: `Source language: ${from} = ${NAMES[from]}.\nTranslate every text of the "texts" array into each of these target languages: ${wanted}.\nReturn exactly this JSON shape: {${to.map(l => `"${l}":["..."]`).join(',')}} where each array has the same length and order as "texts".\n\n${JSON.stringify({ texts })}` },
    ],
  };
  const response = await timed(fetchImpl, 'https://text.pollinations.ai/openai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, ms);
  if (!response.ok) throw new Error(`pollinations ${response.status}`);
  const data = await response.json();
  const content = String(data?.choices?.[0]?.message?.content ?? '');
  const json = content.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error('pollinations empty');
  const parsed = JSON.parse(json);
  const result = {};
  for (const lang of to) {
    const list = parsed?.[lang];
    if (Array.isArray(list) && list.length === texts.length && list.every((out, i) => plausible(lang, texts[i], out))) result[lang] = list.map(out => out.trim());
  }
  return result;
}

/** MyMemory takes at most ~500 characters per request: long texts are cut at line / sentence ends. */
function pieces(text, size = 450) {
  const out = [];
  for (const line of text.split('\n')) {
    let rest = line;
    while (rest.length > size) {
      let cut = Math.max(rest.lastIndexOf('. ', size), rest.lastIndexOf('، ', size), rest.lastIndexOf(', ', size), rest.lastIndexOf(' ', size));
      if (cut < size / 3) cut = size;
      out.push(rest.slice(0, cut + 1)); rest = rest.slice(cut + 1);
    }
    out.push(rest);
  }
  return out;
}
async function myMemory(fetchImpl, pair, text, ms) {
  if (!text.trim()) return text;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${pair}`;
  const response = await timed(fetchImpl, url, {}, ms);
  if (!response.ok) throw new Error(`mymemory ${response.status}`);
  const data = await response.json();
  const out = data?.responseData?.translatedText;
  if (typeof out !== 'string' || !out || /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(out) || data?.quotaFinished) throw new Error('mymemory unusable');
  // MyMemory sometimes HTML-escapes its answer.
  return out.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
/** Provider 2: per language, per text. Darija has no MyMemory code: it is read/written as Arabic. */
async function viaMyMemory(fetchImpl, from, lang, texts, ms) {
  const code = l => (l === 'dar' ? 'ar' : l);
  if (code(from) === code(lang)) return texts.slice(); // Darija <-> Arabic: same text, nothing to translate
  const pair = `${code(from)}|${code(lang)}`;
  const out = await Promise.all(texts.map(async text => (await Promise.all(pieces(text).map(piece => piece.trim() ? myMemory(fetchImpl, pair, piece, ms) : piece))).join(' ').replace(/ ?\n ?/g, '\n').trim()));
  if (!out.every((value, i) => plausible(lang, texts[i], value))) throw new Error('mymemory wrong script');
  return out;
}

/** Validates a request body and returns the clean version, or throws { status: 400 }. */
function clean(input) {
  const bad = message => Object.assign(new Error(message), { status: 400 });
  if (!input || typeof input !== 'object') throw bad('Invalid request');
  if (!LANGS.includes(input.from)) throw bad('Invalid source language');
  const texts = input.texts;
  if (!Array.isArray(texts) || !texts.length || texts.length > MAX_TEXTS || texts.some(value => typeof value !== 'string' || !value.trim() || value.length > MAX_TEXT)) throw bad('Invalid texts');
  if (texts.reduce((sum, value) => sum + value.length, 0) > MAX_TOTAL) throw bad('Texts too long');
  const to = (Array.isArray(input.to) ? input.to : LANGS.filter(l => l !== input.from)).filter((l, i, all) => LANGS.includes(l) && l !== input.from && all.indexOf(l) === i);
  if (!to.length) throw bad('Nothing to translate');
  return { from: input.from, to, texts: texts.map(value => value.trim()) };
}

/**
 * Returns { translations: { <lang>: string[] }, provider: { <lang>: 'pollinations' | 'mymemory' | 'copy' } }.
 * Languages no provider could produce are left out (the admin form then keeps them empty).
 */
async function translate(input, { fetch: fetchImpl = globalThis.fetch, llmMs = 14000, mtMs = 6000 } = {}) {
  const { from, to, texts } = clean(input);
  const translations = {}, provider = {};
  const key = (lang, text) => `${from}>${lang}:${text}`;
  const pending = new Map(to.map(lang => [lang, texts.map(text => cache.get(key(lang, text)))]));
  const missing = lang => pending.get(lang).some(value => value === undefined);
  const store = (lang, list, name) => { list.forEach((out, i) => { remember(key(lang, texts[i]), out); pending.get(lang)[i] = out; }); provider[lang] ??= name; };

  const askLlm = to.filter(missing);
  if (askLlm.length) {
    try { const result = await viaPollinations(fetchImpl, from, askLlm, texts, llmMs); for (const lang of askLlm) if (result[lang]) store(lang, result[lang], 'pollinations'); }
    catch { /* falls through to the machine-translation fallback below */ }
  }
  await Promise.all(to.filter(missing).map(async lang => {
    try { const list = await viaMyMemory(fetchImpl, from, lang, texts, mtMs); store(lang, list, from !== lang && (from === 'dar' && lang === 'ar' || from === 'ar' && lang === 'dar') ? 'copy' : 'mymemory'); }
    catch { /* this language stays empty */ }
  }));
  for (const lang of to) if (!missing(lang)) translations[lang] = pending.get(lang);
  return { translations, provider };
}

module.exports = { translate, clean, plausible, pieces, LANGS };
