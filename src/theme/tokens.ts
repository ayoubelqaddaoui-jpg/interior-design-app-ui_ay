import type { ThemeConfig, ThemeId } from '@/data/types';

export const TOKEN_KEYS = ['bg', 'surface', 'surface2', 'fg', 'muted', 'line', 'primary', 'onprimary', 'soft', 'ink', 'onink', 'danger', 'success'] as const;
export type TokenKey = (typeof TOKEN_KEYS)[number];
export type Tokens = Record<TokenKey, string>;

export const THEMES: Record<Exclude<ThemeId, 'custom'>, Tokens & { dark: boolean }> = {
  light: {
    dark: false, bg: '#FFFFFF', surface: '#FFFFFF', surface2: '#F3F4F6', fg: '#111111', muted: '#6B7280', line: '#E5E7EB',
    primary: '#FBDD2D', onprimary: '#111111', soft: '#FEF6C3', ink: '#111111', onink: '#FFFFFF', danger: '#EF4444', success: '#16A34A',
  },
  dark: {
    dark: true, bg: '#0E0E10', surface: '#1A1A1D', surface2: '#26262A', fg: '#F5F5F5', muted: '#A1A1AA', line: '#2E2E33',
    primary: '#FBDD2D', onprimary: '#111111', soft: '#3A3411', ink: '#F5F5F5', onink: '#111111', danger: '#F87171', success: '#4ADE80',
  },
  royal: {
    dark: true, bg: '#0B1B4D', surface: '#132A6E', surface2: '#1B3585', fg: '#FFFFFF', muted: '#AEBDEB', line: '#2B4496',
    primary: '#FBDD2D', onprimary: '#0B1B4D', soft: '#2A3A7C', ink: '#FFFFFF', onink: '#0B1B4D', danger: '#FB7185', success: '#4ADE80',
  },
};

/** Colours the admin can pick for the custom theme; every other token is derived. */
export const CUSTOM_KEYS = ['primary', 'bg', 'surface', 'fg', 'ink'] as const;

const hex2rgb = (h: string): [number, number, number] => {
  const s = h.replace('#', '');
  const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s.padEnd(6, '0');
  return [parseInt(f.slice(0, 2), 16) || 0, parseInt(f.slice(2, 4), 16) || 0, parseInt(f.slice(4, 6), 16) || 0];
};
const rgb2hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
export const mix = (a: string, b: string, t: number) => {
  const x = hex2rgb(a), y = hex2rgb(b);
  return rgb2hex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
};
export const luminance = (h: string) => {
  const [r, g, b] = hex2rgb(h).map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (bg: string) => (luminance(bg) > 0.55 ? '#111111' : '#FFFFFF');

export function resolveTokens(cfg: ThemeConfig): Tokens & { dark: boolean } {
  if (cfg.active !== 'custom') return THEMES[cfg.active];
  const base = THEMES.light;
  const c = { primary: base.primary, bg: base.bg, surface: base.surface, fg: base.fg, ink: base.ink, ...cfg.custom };
  return {
    dark: luminance(c.bg) < 0.4,
    bg: c.bg, surface: c.surface, fg: c.fg, primary: c.primary, ink: c.ink,
    surface2: mix(c.bg, c.fg, 0.07), muted: mix(c.fg, c.bg, 0.45), line: mix(c.bg, c.fg, 0.13),
    onprimary: contrast(c.primary), soft: mix(c.bg, c.primary, 0.25), onink: contrast(c.ink),
    danger: '#EF4444', success: '#16A34A',
  };
}

export const toVars = (t: Tokens) =>
  Object.fromEntries(TOKEN_KEYS.map((k) => [`--c-${k}`, hex2rgb(t[k]).join(' ')])) as Record<string, string>;
