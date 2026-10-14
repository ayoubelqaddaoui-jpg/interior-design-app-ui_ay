import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, Platform, View } from 'react-native';
import { usePathname, router as expoRouter } from 'expo-router';
import { useStore } from '@/store/useStore';
import { useL, useT } from '@/i18n';
import { registerAppExit, useBackCheckpoint } from '@/hooks/useLeaveGuard';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { Txt } from '@/components/ui/Txt';

/** OS/tab close prompts cannot be customized. Only app-controlled exits use this sheet. */
export function AppExitHost() {
  const path = usePathname();
  const admin = path === '/admin' || path.startsWith('/admin/');
  const settings = useStore(s => s.doc.settings);
  const enabled = !admin && settings.exitConfirmationEnabled !== false;
  if (!enabled) return null;
  return <ExitBoundary key={path} path={path} />;
}
function ExitBoundary({ path }: { path: string }) {
  const settings = useStore(s => s.doc.settings);
  const enabled = true;
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [leaving, setLeaving] = useState(false);
  const allowed = useRef(false);
  const { t } = useT();
  const L = useL();
  useEffect(() => {
    if (!enabled) return;
    return registerAppExit(action => setPending(() => action));
  }, [enabled]);
  useEffect(() => {
    if (!enabled || Platform.OS !== 'web') return;
    const unload = (event: BeforeUnloadEvent) => {
      if (allowed.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const external = (event: MouseEvent) => {
      const link = (event.target as Element)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link || link.target === '_blank' || link.hasAttribute('download') || event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
      if (link.origin === window.location.origin && !link.pathname.startsWith('/admin')) return;
      event.preventDefault();
      event.stopPropagation();
      setPending(() => () => window.location.assign(link.href));
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', external, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', external, true); };
  }, [enabled]);
  // Other pages keep normal Back navigation. Overlays always take priority over exiting.
  useBackCheckpoint(enabled && path === '/' && !leaving, () => {
    setPending(() => () => {
      if (Platform.OS === 'web') window.history.back();
      else if (expoRouter.canGoBack()) expoRouter.back();
      else BackHandler.exitApp();
    });
  }, -1);
  const stay = () => setPending(null);
  const leave = () => {
    const action = pending;
    allowed.current = true;
    setPending(null);
    setLeaving(true);
    // Remove the synthetic history checkpoint before completing a real exit.
    setTimeout(() => action?.(), 80);
  };
  if (!enabled || !pending) return null;
  return <Sheet visible history={false} onClose={stay} title={L(settings.exitTitle) || t('improve.exitTitle')}>
    <Txt testID="exit-message" className="text-[17px] leading-[25px] mb-5">{L(settings.exitMessage) || t('improve.exitMessage')}</Txt>
    <View className="flex-row gap-3">
      <Button testID="exit-stay" title={t('improve.stay')} onPress={stay} className="flex-1" />
      <Button testID="exit-leave" title={t('improve.leave')} variant="soft" onPress={leave} className="flex-1" />
    </View>
  </Sheet>;
}
