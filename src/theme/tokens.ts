import type { ThemeConfig } from '@/data/types';
import { PRESET_BY_ID } from './presets';
import { deriveTokens, hex2rgb, TOKEN_KEYS, type ResolvedTokens, type Tokens } from './color';

export * from './color';
export { PRESETS, PRESET_BY_ID, PRESET_CATEGORIES } from './presets';
export type { PresetCategory } from './presets';

export function resolveTokens(cfg: ThemeConfig): ResolvedTokens {
  if (cfg.active !== 'custom') return (PRESET_BY_ID[cfg.active] ?? PRESET_BY_ID.light).tokens;
  const b = PRESET_BY_ID.light.tokens;
  return deriveTokens({ primary: b.primary, bg: b.bg, surface: b.surface, fg: b.fg, ink: b.ink, ...cfg.custom });
}

export const toVars = (t: Tokens) =>
  Object.fromEntries(TOKEN_KEYS.map((k) => [`--c-${k}`, hex2rgb(t[k]).join(' ')])) as Record<string, string>;
