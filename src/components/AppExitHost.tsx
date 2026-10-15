import { useEffect } from 'react';
import { Platform } from 'react-native';
import { requestLeave } from '@/hooks/useLeaveGuard';

/** External links use the same dirty guards. No generic exit popup on clean pages. */
export function AppExitHost() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const external = (event: MouseEvent) => {
      const link = (event.target as Element)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link || link.target === '_blank' || link.hasAttribute('download') || event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0 || link.origin === window.location.origin) return;
      event.preventDefault();
      requestLeave(() => window.location.assign(link.href));
    };
    document.addEventListener('click', external, true);
    return () => document.removeEventListener('click', external, true);
  }, []);
  return null;
}
