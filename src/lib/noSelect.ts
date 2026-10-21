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
