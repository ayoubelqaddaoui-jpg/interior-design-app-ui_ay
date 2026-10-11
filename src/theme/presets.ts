import type { LText } from '@/data/types';
import { deriveTokens, type Base5, type ResolvedTokens } from './color';

export type PresetCategory = 'essentials' | 'nature' | 'warm' | 'cool' | 'luxury' | 'vibrant';
export const PRESET_CATEGORIES: PresetCategory[] = ['essentials', 'nature', 'warm', 'cool', 'luxury', 'vibrant'];

export interface Preset { id: string; category: PresetCategory; name: LText; base: Base5; tokens: ResolvedTokens }

const L = (dar: string, ar: string, fr: string): LText => ({ dar, ar, fr });
const P = (id: string, category: PresetCategory, name: LText, base: Base5): Preset => ({ id, category, name, base, tokens: deriveTokens(base) });

/**
 * 20 hand-tuned palettes. Each one defines 5 base colours (accent, page, card, text, "ink" button) and every
 * other UI token (muted text, borders, soft tint, text-on-accent, text-on-ink) is derived with a WCAG contrast
 * check, so any UI element (buttons, chips, cards, nav, charts, toggles) stays legible in every preset.
 * Run `npm run check:themes` to print the contrast report.
 */
export const PRESETS: Preset[] = [
  /* ---------- Essentials ---------- */
  P('light', 'essentials', L('دويرة الأصفر', 'أصفر دويرة', 'Dwira Jaune'), { primary: '#FBDD2D', bg: '#FFFFFF', surface: '#FFFFFF', fg: '#111111', ink: '#111111' }),
  P('dark', 'essentials', L('ليل داكن', 'ليلي داكن', 'Nuit sombre'), { primary: '#FBDD2D', bg: '#0E0E10', surface: '#1A1A1D', fg: '#F5F5F5', ink: '#F5F5F5' }),
  P('royal', 'essentials', L('أزرق ملكي', 'أزرق ملكي', 'Bleu royal'), { primary: '#FBDD2D', bg: '#0B1B4D', surface: '#132A6E', fg: '#FFFFFF', ink: '#FFFFFF' }),
  P('mono', 'essentials', L('أبيض وكحل', 'أبيض وأسود', 'Mono épuré'), { primary: '#111111', bg: '#FAFAFA', surface: '#FFFFFF', fg: '#171717', ink: '#171717' }),

  /* ---------- Nature ---------- */
  P('forest', 'nature', L('غابة خضراء', 'غابة خضراء', 'Forêt'), { primary: '#2F7D4F', bg: '#F4F8F4', surface: '#FFFFFF', fg: '#14281D', ink: '#1B3A2A' }),
  P('sage', 'nature', L('جنان هادي', 'حديقة هادئة', 'Sauge'), { primary: '#8FAE7E', bg: '#F7F8F2', surface: '#FFFFFF', fg: '#27301F', ink: '#3C4A30' }),
  P('ocean', 'nature', L('بحر', 'محيط', 'Océan'), { primary: '#0E7490', bg: '#F1F8FB', surface: '#FFFFFF', fg: '#0B2F3A', ink: '#0C3B4A' }),
  P('emerald', 'nature', L('زمرد الليل', 'زمرد ليلي', 'Émeraude nuit'), { primary: '#34D399', bg: '#07130F', surface: '#0F231B', fg: '#E8FBF3', ink: '#E8FBF3' }),

  /* ---------- Warm ---------- */
  P('terracotta', 'warm', L('طين مغربي', 'تراكوتا', 'Terracotta'), { primary: '#C2542D', bg: '#FBF5EF', surface: '#FFFFFF', fg: '#3B1D12', ink: '#3B1D12' }),
  P('sunset', 'warm', L('غروب', 'غروب الشمس', 'Coucher de soleil'), { primary: '#F97316', bg: '#FFF8F1', surface: '#FFFFFF', fg: '#3B1405', ink: '#431407' }),
  P('sand', 'warm', L('رمال الصحراء', 'رمال الصحراء', 'Sable du désert'), { primary: '#B7791F', bg: '#F8F2E7', surface: '#FFFDF8', fg: '#33290F', ink: '#3A2E1A' }),
  P('rose', 'warm', L('ورد', 'وردي', 'Rose'), { primary: '#E11D48', bg: '#FFF6F8', surface: '#FFFFFF', fg: '#4C0519', ink: '#4C0519' }),

  /* ---------- Cool ---------- */
  P('sky', 'cool', L('سما', 'سماوي', 'Ciel'), { primary: '#2563EB', bg: '#F2F7FF', surface: '#FFFFFF', fg: '#0B1F4D', ink: '#0B2559' }),
  P('lavender', 'cool', L('لافاندر', 'لافندر', 'Lavande'), { primary: '#7C3AED', bg: '#F8F6FF', surface: '#FFFFFF', fg: '#2A1065', ink: '#2E1065' }),
  P('mint', 'cool', L('نعناع', 'نعناعي', 'Menthe'), { primary: '#14B8A6', bg: '#F0FBF8', surface: '#FFFFFF', fg: '#0F3D38', ink: '#0F3D38' }),

  /* ---------- Luxury ---------- */
  P('gold', 'luxury', L('ذهبي وأسود', 'ذهبي وأسود', 'Noir & or'), { primary: '#D4AF37', bg: '#0F0D08', surface: '#1B1810', fg: '#F6EFD9', ink: '#F6EFD9' }),
  P('burgundy', 'luxury', L('بوردو', 'عنابي', 'Bordeaux'), { primary: '#7F1D1D', bg: '#FBF4F3', surface: '#FFFFFF', fg: '#3A0D0D', ink: '#3A0D0D' }),
  P('graphite', 'luxury', L('غرافيت', 'جرافيت', 'Graphite'), { primary: '#60A5FA', bg: '#111418', surface: '#1B2027', fg: '#E7EAEE', ink: '#E7EAEE' }),

  /* ---------- Vibrant ---------- */
  P('neon', 'vibrant', L('نيون', 'نيون', 'Néon'), { primary: '#A3E635', bg: '#0A0A14', surface: '#15152A', fg: '#F4F4FF', ink: '#F4F4FF' }),
  P('candy', 'vibrant', L('حلوى', 'حلوى', 'Bonbon'), { primary: '#EC4899', bg: '#FFF5FB', surface: '#FFFFFF', fg: '#4A0D2E', ink: '#4A0D2E' }),
];

export const PRESET_BY_ID: Record<string, Preset> = Object.fromEntries(PRESETS.map((p) => [p.id, p]));
