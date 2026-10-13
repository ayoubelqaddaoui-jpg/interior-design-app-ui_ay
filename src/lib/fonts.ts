import { useEffect, useSyncExternalStore } from 'react';
import * as Font from 'expo-font';

/** Assets stay bundled for offline/native use, but only requested families are loaded. */
const sources: Record<string, number> = {
  Inter: require('../../assets/fonts/Inter.ttf'), Tajawal: require('../../assets/fonts/Tajawal.ttf'),
  Roboto: require('../../assets/fonts/Roboto.ttf'), Poppins: require('../../assets/fonts/Poppins.ttf'),
  Montserrat: require('../../assets/fonts/Montserrat.ttf'), Lato: require('../../assets/fonts/Lato.ttf'),
  Cairo: require('../../assets/fonts/Cairo.ttf'), 'IBM Plex Sans Arabic': require('../../assets/fonts/IBMPlexSansArabic.ttf'),
  'Noto Sans Arabic': require('../../assets/fonts/NotoSansArabic.ttf'), Alexandria: require('../../assets/fonts/Alexandria.ttf'),
  Lora: require('../../assets/fonts/Lora.ttf'), NotoNaskhArabic: require('../../assets/fonts/NotoNaskhArabic.ttf'),
};
const pending = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let revision = 0;
const notify = () => { revision++; listeners.forEach((listener) => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function ensureFont(family: string): Promise<void> {
  if (!sources[family] || Font.isLoaded(family)) return Promise.resolve();
  const current = pending.get(family);
  if (current) return current;
  const promise = Font.loadAsync(family, { uri: sources[family], display: Font.FontDisplay.SWAP })
    .then(notify).finally(() => { pending.delete(family); });
  pending.set(family, promise);
  return promise;
}
/** Never renders an unloaded font; fixed line heights in specimens keep the fallback stable. */
export function useFontFamily(family?: string, fallback = 'Inter') {
  useSyncExternalStore(subscribe, () => revision, () => 0);
  useEffect(() => { if (family && family !== 'system') ensureFont(family).catch(() => { /* Keep the readable bundled fallback if an asset cannot be loaded. */ }); }, [family]);
  if (family && Font.isLoaded(family)) return family;
  return Font.isLoaded(fallback) ? fallback : undefined;
}
