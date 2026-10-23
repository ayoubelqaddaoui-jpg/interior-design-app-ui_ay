import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import type { AppSettings, LoaderAnim, LoaderStyle } from '@/data/types';
import { storage } from '@/data/mock/storage';

/**
 * Startup loading screen controller (admin: Interface > Loading screen).
 *
 * Web: the loader is plain HTML/SVG written into index.html by scripts/postexport.js, so it paints with the first bytes of
 * the page (before any JavaScript). It reads the last known configuration from localStorage (`dwira:v1:loader`) and is
 * corrected as soon as the early /api/content answer arrives. The app removes it through `window.__dwiraBoot.hide()`.
 * Native (and web dev builds without the shell): <BootOverlay/> draws the same loader in React.
 *
 * The same loader (style, colour, custom image) is used on every start page, and in-app spinners reuse it (<Spinner/>).
 *
 * When the startup loader disappears:
 *  - loader off            -> never shown;
 *  - delay 0 (automatic)   -> Home: as soon as its first two cards have painted their image; any other start page: as soon
 *                             as that screen is ready. A safety cap means it can never stay forever;
 *  - delay N ms            -> N ms after the page started opening, and never before the first screen is ready.
 */
export interface LoaderConfig { enabled: boolean; style: LoaderStyle; color: string; bg: string; uri: string; anim: LoaderAnim; delayMs: number }
export const LOADER_STYLES: LoaderStyle[] = ['ring', 'dots', 'pulse', 'bars', 'custom'];
export const LOADER_DELAYS = [0, 500, 1000, 1500, 2000, 3000, 5000];
/** Delay values above this are clamped: a loading screen must never hide the app for long. */
export const MAX_LOADER_DELAY = 10000;
/** Automatic mode: hide even if the card images never load (offline, broken URL). */
const AUTO_CAP_MS = 6000;
/** Cards that must have painted before the automatic mode removes the loader. */
const CARDS_TO_WAIT = 2;

export const loaderConfig = (settings: AppSettings, colors: { ink: string; bg: string }): LoaderConfig => ({
  enabled: settings.loaderEnabled !== false,
  style: LOADER_STYLES.includes(settings.loaderStyle as LoaderStyle) ? settings.loaderStyle as LoaderStyle : 'ring',
  color: /^#[0-9a-fA-F]{6}$/.test(settings.loaderColor || '') ? settings.loaderColor! : colors.ink,
  bg: colors.bg,
  uri: settings.loaderCustomUri || '',
  anim: settings.loaderCustomAnim === 'spin' || settings.loaderCustomAnim === 'pulse' ? settings.loaderCustomAnim : 'none',
  delayMs: Math.max(0, Math.min(MAX_LOADER_DELAY, Math.round(Number(settings.loaderDelayMs) || 0))),
});

interface Shell { hide(): void; apply?(cfg: Partial<LoaderConfig>): void; active?: boolean }
const shell = (): Shell | undefined => (Platform.OS === 'web' && typeof window !== 'undefined' ? (window as unknown as { __dwiraBoot?: Shell }).__dwiraBoot : undefined);
/** True when index.html drew the loader (production web build); otherwise React draws it. */
export const shellLoader = () => !!shell();

// performance.now() counts from navigation start on the web, which is what "N ms after opening" means for a visitor.
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const startedAt = Platform.OS === 'web' ? 0 : now();

let config: LoaderConfig | null = null;
let hidden = false;
let appShown = false;
let waitCards = true;
let cardCount = -1;
const painted = new Set<number>();
let timer: ReturnType<typeof setTimeout> | undefined;
let capTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function hide() {
  if (hidden) return;
  hidden = true;
  clearTimeout(timer); clearTimeout(capTimer);
  shell()?.hide();
  notify();
}

function check() {
  if (hidden || !config) return;
  if (!config.enabled) return hide();
  if (!appShown) return;
  clearTimeout(timer);
  if (config.delayMs > 0) {
    const left = config.delayMs - (now() - startedAt);
    if (left <= 0) hide(); else timer = setTimeout(check, left);
    return;
  }
  const needed = Math.min(CARDS_TO_WAIT, Math.max(cardCount, 0));
  if (!waitCards || (cardCount >= 0 && painted.size >= needed)) hide();
}

export const boot = {
  /** Configuration to use until the real settings arrive (not remembered for the next visit). */
  preset(next: LoaderConfig) { if (!config) { config = next; notify(); check(); } },
  /** Latest admin configuration (called whenever settings or theme change). Also remembered for the next visit's HTML shell. */
  configure(next: LoaderConfig) {
    const changed = JSON.stringify(next) !== JSON.stringify(config);
    config = next;
    if (!changed) return;
    void storage.write('loader', next);
    if (!hidden) shell()?.apply?.(next);
    notify();
    check();
  },
  /** The first screen is mounted. `home` = it is the Home screen, whose first cards decide when the loader goes away. */
  shown(home: boolean) {
    if (appShown) return;
    appShown = true;
    waitCards = home;
    capTimer = setTimeout(() => { if (!config || config.delayMs === 0) hide(); }, AUTO_CAP_MS);
    check();
  },
  /** Home knows how many cards it will show (-1 = content still loading). */
  cards(count: number) { cardCount = count; check(); },
  /** A Home card at `index` has painted its image / video poster (or failed to, which also ends the wait). */
  cardPainted(index: number) { if (index < CARDS_TO_WAIT && !painted.has(index)) { painted.add(index); check(); } },
  isHidden: () => hidden,
};

/** React side: true while the loader must be drawn by React (native, or a web build without the HTML shell loader). */
export function useBootOverlay() {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => (hidden || shellLoader() || !config?.enabled ? null : config),
    () => null,
  );
}
