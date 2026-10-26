import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Platform, View } from 'react-native';
import { create } from 'zustand';
import { useTheme } from '@/theme/ThemeProvider';
import { useScrollAncestors } from './useViewState';

/**
 * "Scroll to what I just added, then highlight it": one reusable mechanism for every admin list.
 *
 * A screen calls `revealAdded(ids)` once the new rows are stored. The list wraps each row in `<RevealTarget id>`; the
 * first id is scrolled into view (the list pages to it first), every id in the group pulses together. The request
 * expires after a few seconds so a row that mounts later (another page, a slow render) is still revealed, but an old
 * request never fires again on a later visit.
 */
interface Request { ids: string[]; token: number; at: number }
export const useReveal = create<{ current: Request | null; reveal(ids: string[]): void }>((set) => ({
  current: null,
  reveal: (ids) => set((s) => ({ current: ids.length ? { ids, token: (s.current?.token ?? 0) + 1, at: Date.now() } : s.current })),
}));
export const revealAdded = (ids: string[]) => useReveal.getState().reveal(ids);

/** Thrown by a bulk save that stored only some of its rows: the message tells the admin exactly what happened. */
export class PartialSaveError extends Error {
  constructor(message: string, readonly saved: string[]) { super(message); this.name = 'PartialSaveError'; }
}

const LIFETIME_MS = 8000;
/** Lets a closing popup finish its exit animation before the list starts moving. */
const SETTLE_MS = 320;
const reducedMotion = () => Platform.OS === 'web' && typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function RevealTarget({ id, children }: { id: string; children: React.ReactNode }) {
  const request = useReveal((s) => s.current);
  const { colors } = useTheme();
  const scroll = useScrollAncestors();
  const ref = useRef<View>(null);
  const handled = useRef(0);
  const [glow] = useState(() => new Animated.Value(0));
  const [on, setOn] = useState(false);
  const token = request && request.ids.includes(id) ? request.token : 0;
  const first = request?.ids[0] === id;
  const group = (request?.ids.length ?? 0) > 1;

  const scrollTo = useCallback(() => {
    if (Platform.OS === 'web') {
      const node = ref.current as unknown as HTMLElement | null;
      node?.scrollIntoView?.({ behavior: reducedMotion() ? 'auto' : 'smooth', block: group ? 'start' : 'center', inline: 'nearest' });
      return;
    }
    for (const ancestor of scroll) {
      const parent = ancestor.ref.current?.getInnerViewNode();
      if (parent && !ancestor.horizontal) ref.current?.measureLayout(parent, (_x, y) => ancestor.ref.current?.scrollTo({ y: Math.max(0, y - (group ? 16 : Dimensions.get('window').height * 0.3)), animated: true }), () => {});
    }
  }, [scroll, group]);

  useEffect(() => {
    if (!token || handled.current === token) return;
    const age = Date.now() - (request?.at ?? 0);
    if (age > LIFETIME_MS) return; // an old request never fires on a later visit
    const timer = setTimeout(() => {
      handled.current = token;
      if (first) scrollTo();
      setOn(true);
      glow.setValue(0);
      const pulse = (to: number, duration: number) => Animated.timing(glow, { toValue: to, duration, useNativeDriver: true });
      // Two soft pulses, then gone: noticeable without shouting.
      (reducedMotion() ? Animated.sequence([pulse(1, 200), pulse(0, 1200)]) : Animated.sequence([pulse(1, 260), pulse(0.35, 380), pulse(1, 260), pulse(0, 900)])).start(() => setOn(false));
    }, Math.max(0, SETTLE_MS - age) + (first ? 0 : 60));
    return () => clearTimeout(timer);
  }, [token, first, request?.at, scrollTo, glow]);

  return <View ref={ref} collapsable={false} testID={`reveal-${id}`} style={[{ minWidth: 0 }, Platform.OS === 'web' && group ? ({ scrollMarginTop: 16 } as object) : null]}>
    {children}
    {on ? <Animated.View pointerEvents="none" testID={`reveal-glow-${id}`} style={{ position: 'absolute', inset: 0, borderRadius: 24, borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.primary, opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0, 0.28] }) }} /> : null}
  </View>;
}
