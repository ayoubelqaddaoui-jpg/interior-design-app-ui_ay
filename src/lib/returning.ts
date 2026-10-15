import type { Lang } from '@/data/types';
import { api, backendEnabled } from './backend';
import { storage } from '@/data/mock/storage';

export type MessageText = { headline: string; body: string; benefits: string[]; primary: string; secondary: string };
export type MessageVersion = { id: string; label: string; enabled: boolean; weight: number; texts: Record<Lang, MessageText> };
export type MessageResult = { id: string; label: string; deleted: boolean; views: number; clicks: number; purchases: number; conversion: number };
export const messageLimits = { headline: 120, body: 600, primary: 60, secondary: 60, benefit: 140 };
export const cleanMessage = (value: unknown, max: number) => String(value ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, max);
export const defaultMessage: Record<Lang, MessageText> = {
  dar: { headline: 'مرحبا برجوعك {name}!', body: 'استعملتي التصميم المجاني ديالك. كمّل مع Pro ابتداءً من {price}. باقي عندك {remaining} تصميم.', benefits: ['تصاميم جديدة لدارك', 'ستايلات وألوان متنوعة', 'حفظ ومشاركة التصاميم'], primary: 'شوف عروض Pro', secondary: 'من بعد' },
  ar: { headline: 'مرحباً بعودتك {name}!', body: 'لقد استخدمت تصميمك المجاني. تابع مع Pro ابتداءً من {price}. لديك {remaining} تصميم متبقٍ.', benefits: ['تصاميم جديدة لمنزلك', 'أنماط وألوان متنوعة', 'حفظ التصاميم ومشاركتها'], primary: 'عرض خطط Pro', secondary: 'لاحقاً' },
  fr: { headline: 'Bon retour {name} !', body: 'Votre création gratuite a été utilisée. Continuez avec Pro dès {price}. Il vous reste {remaining} création(s).', benefits: ['De nouvelles idées pour votre intérieur', 'Des styles et couleurs variés', 'Enregistrez et partagez vos créations'], primary: 'Voir les offres Pro', secondary: 'Plus tard' },
};
export function renderMessage(text: MessageText, lang: Lang, values: { name?: string; price?: string; remaining?: number } = {}): MessageText {
  const vars = { name: cleanMessage(values.name, 120) || (lang === 'fr' ? 'à vous' : 'بيك'), price: cleanMessage(values.price, 40) || '149 MAD', remaining: String(Number.isFinite(values.remaining) && values.remaining! >= 0 ? values.remaining : 0) };
  const fill = (value: string) => cleanMessage(value, 600).replace(/\{(name|price|remaining)\}/g, (_, key: keyof typeof vars) => vars[key]);
  return { headline: fill(text.headline), body: fill(text.body), benefits: text.benefits.slice(0, 4).map(fill), primary: fill(text.primary), secondary: fill(text.secondary) };
}
export function sanitizeVersions(rows: MessageVersion[]): MessageVersion[] {
  return rows.slice(0, 26).map(row => ({ ...row, label: cleanMessage(row.label, 40), texts: Object.fromEntries((['dar', 'ar', 'fr'] as Lang[]).map(lang => {
    const text = row.texts[lang];
    return [lang, { headline: cleanMessage(text.headline, 120), body: cleanMessage(text.body, 600), primary: cleanMessage(text.primary, 60), secondary: cleanMessage(text.secondary, 60), benefits: text.benefits.slice(0, 4).map(v => cleanMessage(v, 140)).filter(Boolean) }];
  })) as Record<Lang, MessageText> }));
}
export const returningRepo = {
  async list(): Promise<MessageVersion[]> { return backendEnabled ? api('/admin/returning') : (await storage.read<MessageVersion[]>('returning-versions')) || []; },
  async save(rows: MessageVersion[]): Promise<MessageVersion[]> {
    const versions = sanitizeVersions(rows);
    if (backendEnabled) return api('/admin/returning', { method: 'PATCH', body: { versions } });
    await storage.write('returning-versions', versions);
    return versions;
  },
  async message(): Promise<{ eligible: boolean; version: MessageVersion | null }> {
    return backendEnabled ? api('/user/returning') : { eligible: true, version: null };
  },
  async event(versionId: string | null, kind: 'view' | 'click' | 'upgrade_confirmation') {
    if (!backendEnabled || (!versionId && kind !== 'upgrade_confirmation')) return;
    await api('/user/returning/event', { method: 'POST', body: { versionId, kind } });
  },
  async results(from: string, to: string): Promise<MessageResult[]> {
    if (!backendEnabled) return [];
    return api(`/admin/returning/results?${new URLSearchParams({ from, to })}`);
  },
};
