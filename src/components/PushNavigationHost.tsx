import { useEffect } from 'react';
import { Linking, Platform } from 'react-native';
import type { Href } from 'expo-router';
import { router } from '@/hooks/useLeaveGuard';
import { backendEnabled, api } from '@/lib/backend';
import { useLang } from '@/i18n';
import { useLocal } from '@/store/useLocal';

/** Native Android uses device FCM tokens; browser builds resolve the .web file instead. */
export function PushNavigationHost() {
  useEffect(() => {
    if (!backendEnabled || Platform.OS !== 'android') return;
    let disposed = false;
    let remove = () => {};
    import('expo-notifications').then(async n => {
      if (disposed) return;
      n.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
      const handle = (response: import('expo-notifications').NotificationResponse) => {
        const data = response.notification.request.content.data;
        const phone = String(data.phone || '').replace(/[^\d+]/g, '').slice(0, 32);
        if (response.actionIdentifier === 'call' && /^\+?\d{6,20}$/.test(phone)) { void Linking.openURL(`tel:${phone}`); return; }
        if (typeof data.url === 'string' && /^\/admin\/requests(?:\?|$)/.test(data.url)) router.push(data.url as Href);
      };
      const response = n.addNotificationResponseReceivedListener(handle);
      const token = n.addPushTokenListener(device => {
        if (!useLocal.getState().adminSession || device.type !== 'android') return;
        void api('/push/subscriptions', { method: 'POST', body: { kind: 'fcm', token: device.data, language: useLang.getState().lang } }).catch(() => {});
      });
      remove = () => { response.remove(); token.remove(); };
      if (disposed) { remove(); return; }
      const last = await n.getLastNotificationResponseAsync();
      if (last && !disposed) { handle(last); await n.clearLastNotificationResponseAsync(); }
    }).catch(() => {});
    return () => { disposed = true; remove(); };
  }, []);
  return null;
}
