export const TOKEN_KEYS = ['bg', 'surface', 'surface2', 'fg', 'muted', 'line', 'primary', 'onprimary', 'soft', 'ink', 'onink', 'danger', 'success'] as const;
export type TokenKey = (typeof TOKEN_KEYS)[number];
export type Tokens = Record<TokenKey, string>;
export type ResolvedTokens = Tokens & { dark: boolean };

/** Colours the admin can pick for the custom theme; every other token is derived. */
export const CUSTOM_KEYS = ['primary', 'bg', 'surface', 'fg', 'ink'] as const;
export type CustomKey = (typeof CUSTOM_KEYS)[number];

/* ------------------------------ colour maths ------------------------------ */
export const hex2rgb = (h: string): [number, number, number] => {
  const s = h.replace('#', '');
  const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s.padEnd(6, '0');
  return [parseInt(f.slice(0, 2), 16) || 0, parseInt(f.slice(2, 4), 16) || 0, parseInt(f.slice(4, 6), 16) || 0];
};
export const rgb2hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
export const mix = (a: string, b: string, t: number) => {
  const x = hex2rgb(a), y = hex2rgb(b);
  return rgb2hex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
};
/** WCAG relative luminance. */
export const luminance = (h: string) => {
  const [r, g, b] = hex2rgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG contrast ratio (1..21). */
export const ratio = (a: string, b: string) => {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
/** Best readable text colour on `bg` among near-black / white / the given candidates. */
export const readableOn = (bg: string, ...extra: string[]) =>
  [...extra, '#111111', '#FFFFFF'].reduce((best, c) => (ratio(bg, c) > ratio(bg, best) ? c : best));
export const isDark = (bg: string) => luminance(bg) < 0.18;

/** Muted text: as soft as possible while staying >= 4.5:1 on both the page and the secondary surface. */
function mutedFor(fg: string, bg: string, surface2: string) {
  for (let t = 0.5; t >= 0.2; t -= 0.05) {
    const c = mix(fg, bg, t);
    if (ratio(c, bg) >= 4.5 && ratio(c, surface2) >= 4.5) return c;
  }
  return mix(fg, bg, 0.2);
}

export interface Base5 { primary: string; bg: string; surface: string; fg: string; ink: string }
/** Derive the full token set from 5 base colours (used by the custom theme and by every preset). */
export function deriveTokens(c: Base5, over: Partial<Tokens> = {}): ResolvedTokens {
  const dark = isDark(c.bg);
  const surface2 = mix(c.bg, c.fg, dark ? 0.1 : 0.06);
  return {
    dark,
    bg: c.bg, surface: c.surface, fg: c.fg, primary: c.primary, ink: c.ink,
    surface2,
    muted: mutedFor(c.fg, c.bg, surface2),
    line: mix(c.bg, c.fg, dark ? 0.18 : 0.13),
    onprimary: readableOn(c.primary),
    soft: mix(c.bg, c.primary, dark ? 0.22 : 0.2),
    onink: readableOn(c.ink, c.bg),
    // semantic colours: white text must stay readable on them, and they must stand out on the page
    danger: dark ? '#E5484D' : '#DC2626',
    success: dark ? '#1F9D55' : '#15803D',
    ...over,
  };
}

