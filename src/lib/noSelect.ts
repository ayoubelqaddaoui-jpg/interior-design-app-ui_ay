import { Platform, type ViewStyle } from 'react-native';

/**
 * Press-and-hold surfaces (Before button, slider, drag handles) must never start a text selection,
 * an image drag or the iOS/Android callout. Web-only CSS: native ignores it.
 */
export const NO_SELECT = (Platform.OS === 'web'
  ? { userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', WebkitTapHighlightColor: 'transparent' }
  : {}) as ViewStyle;

/** Long-press on touch devices opens a context menu on web; spread this on any press-and-hold control to suppress it. */
export const NO_CONTEXT_MENU = (Platform.OS === 'web' ? { onContextMenu: (e: { preventDefault?: () => void }) => e.preventDefault?.() } : {}) as object;

/** Drop whatever text the browser already selected (a long press starts a selection before our handler runs). Web only. */
export const clearTextSelection = () => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try { window.getSelection?.()?.removeAllRanges(); } catch { /* nothing selected */ }
};

/**
 * Props for rows that are selected with a long press: no text selection, no callout, no context menu, and any selection that
 * slipped in is cleared as soon as the long press fires. Spread on the Pressable; compose `onLongPress` through `holdPress`.
 */
export const PRESS_HOLD = { style: NO_SELECT, ...NO_CONTEXT_MENU } as { style: ViewStyle };
export const holdPress = (action: () => void) => () => { clearTextSelection(); action(); };
