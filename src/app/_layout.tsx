import '../global.css';
import '@/lib/interop';
import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Stack, usePathname } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ensureFont } from '@/lib/fonts';
import { loadIcons } from '@/components/ui/Icon';
import * as SplashScreen from 'expo-splash-screen';
import { useStore } from '@/store/useStore';
import { useUserSession } from '@/store/useUserSession';
import { useLocal } from '@/store/useLocal';
import { initLang, useLang, isRtl } from '@/i18n';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { UnsavedChangesHost } from '@/hooks/useLeaveGuard';
import { AppExitHost } from '@/components/AppExitHost';
import { PushNavigationHost } from '@/components/PushNavigationHost';
import { GlobalSearch } from '@/components/GlobalSearch';
import { ToastHost } from '@/components/ui/Toast';
import { startPreferenceBindings, startSync } from '@/lib/sync';

SplashScreen.preventAutoHideAsync().catch(() => {});

/** All content comes from the database: when the server cannot be reached yet, keep trying instead of showing an empty app. */
async function initWithRetry() {
  for (let attempt = 0; ; attempt++) {
    try { await useStore.getState().init(); return; }
    catch { await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 8000))); }
  }
}

export default function RootLayout() {
  const initialPath = usePathname();
  const [booted, setBooted] = useState(false);
  const ready = useStore((s) => s.ready);
  const loaded = useLocal((s) => s.loaded);
  const lang = useLang((s) => s.lang);

  useEffect(() => {
    (async () => {
      // Device flags first: init() decides from them whether to load the admin-only lists.
      await Promise.all([initLang(), useLocal.getState().load().then(() => useUserSession.getState().refresh()).then(initWithRetry)]);
      const { settings, branding } = useStore.getState().doc;
      const family = useLang.getState().lang === 'fr' ? settings.frenchFont || 'Inter' : settings.arabicFont || 'Tajawal';
      // Resolve actual persisted fonts once, before text mounts: no fallback/swap layout shift.
      await Promise.allSettled([ensureFont(family), ensureFont(branding.logoFont || 'Inter'), loadIcons(), ...(initialPath.startsWith('/admin') ? [ensureFont(settings.arabicFont || 'Tajawal'), ensureFont(settings.frenchFont || 'Inter')] : [])]);
      setBooted(true);
      SplashScreen.hideAsync().catch(() => {});
    })();
  // Startup route is captured once; later navigation must never restart initialization.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ok = ready && loaded && booted;
  // Real-time sync + database-backed preferences start once the first data is on screen.
  useEffect(() => {
    if (!ok) return;
    const stopPrefs = startPreferenceBindings();
    const stopSync = startSync();
    return () => { stopSync(); stopPrefs(); };
  }, [ok]);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          {/* `direction` flips every flex-row on native + web: Darija/Arabic = RTL, French = LTR. */}
          <View style={{ flex: 1, direction: isRtl(lang) ? 'rtl' : 'ltr' } as any}>
            {ok ? (
              <>
              <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: 'transparent' } }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="pro" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
              </Stack>
              <GlobalSearch />
              <AppExitHost />
              <PushNavigationHost />
              </>
            ) : (
              <View className="flex-1 items-center justify-center bg-bg"><ActivityIndicator /></View>
            )}
            <ToastHost />
            <UnsavedChangesHost />
          </View>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
