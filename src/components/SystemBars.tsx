import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as SystemUI from 'expo-system-ui';
import { NavigationBar } from 'expo-navigation-bar';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Status bar + Android navigation bar follow the app background chosen by the admin (theme stored in the database),
 * instead of the fixed brand yellow from the native splash configuration.
 *  - Android app (edge-to-edge): the bars are transparent, so the root view colour shows through behind them;
 *    the icons switch light/dark to stay readable.
 *  - Web / installed PWA: `<meta name="theme-color">` colours the browser / standalone status bar.
 */
export function SystemBars() {
  const { colors, dark } = useTheme();
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});
    if (Platform.OS === 'android') { try { NavigationBar.setStyle(dark ? 'light' : 'dark'); } catch { /* older Android: keep default */ } }
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
      if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
      meta.content = colors.bg;
      try { localStorage.setItem('dwira:v1:bar-color', colors.bg); } catch { /* private mode */ }
    }
  }, [colors.bg, dark]);
  return null;
}
