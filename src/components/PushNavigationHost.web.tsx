import { useEffect } from 'react';
import type { Href } from 'expo-router';
import { router } from '@/hooks/useLeaveGuard';
import { backendEnabled } from '@/lib/backend';

export function PushNavigationHost() {
  useEffect(() => {
    if (!backendEnabled || !('serviceWorker' in navigator)) return;
    const open = (event: MessageEvent) => {
      if (event.data?.type !== 'dwira:notification-open' || typeof event.data.url !== 'string') return;
      const url = new URL(event.data.url, window.location.origin);
      if (url.origin === window.location.origin && (['/admin/requests', '/admin/users', '/admin/chats', '/history'].includes(url.pathname) || /^\/chat\/[A-Za-z0-9_-]{1,100}$/.test(url.pathname))) router.push((url.pathname + url.search) as Href);
    };
    navigator.serviceWorker.addEventListener('message', open);
    return () => navigator.serviceWorker.removeEventListener('message', open);
  }, []);
  return null;
}
