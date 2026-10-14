import i18n from '@/i18n';
import { Platform } from 'react-native';
import type { Lang } from '@/data/types';
import { api, backendEnabled } from './backend';

export type PushStatus = 'enabled' | 'disabled' | 'blocked' | 'unsupported' | 'unconfigured';
const tokenKey = 'dwira-fcm-token';
async function notifications() { return import('expo-notifications'); }
export async function pushStatus(): Promise<PushStatus> {
  if (!backendEnabled) return 'unconfigured';
  // Expo's iOS device token is APNs, not FCM. Do not send it to the FCM backend.
  if (Platform.OS !== 'android') return 'unsupported';
  const n = await notifications();
  const permission = await n.getPermissionsAsync();
  if (permission.status === 'denied') return 'blocked';
  const { getItemAsync } = await import('expo-secure-store');
  return await getItemAsync(tokenKey) ? 'enabled' : 'disabled';
}
export async function enablePush(language: Lang): Promise<PushStatus> {
  if (!backendEnabled || Platform.OS !== 'android') return pushStatus();
  const config = await api<{ android: boolean }>('/push/config');
  if (!config.android) return 'unconfigured';
  const n = await notifications();
  await n.setNotificationChannelAsync('demands', { name: String(i18n.t('push.title')), importance: n.AndroidImportance.HIGH });
  const permission = await n.requestPermissionsAsync();
  if (!permission.granted) return permission.status === 'denied' ? 'blocked' : 'disabled';
  const device = await n.getDevicePushTokenAsync();
  if (device.type !== 'android' || typeof device.data !== 'string') return 'unsupported';
  await api('/push/subscriptions', { method: 'POST', body: { kind: 'fcm', token: device.data, language } });
  await (await import('expo-secure-store')).setItemAsync(tokenKey, device.data);
  return 'enabled';
}
export async function syncPushLanguage(language: Lang) {
  if (!backendEnabled || Platform.OS !== 'android') return;
  const token = await (await import('expo-secure-store')).getItemAsync(tokenKey);
  if (token) await api('/push/subscriptions', { method: 'POST', body: { kind: 'fcm', token, language } });
}
export async function disablePush() {
  const secure = await import('expo-secure-store');
  const token = await secure.getItemAsync(tokenKey);
  if (token) await api('/push/subscriptions', { method: 'DELETE', body: { kind: 'fcm', token } });
  await secure.deleteItemAsync(tokenKey);
}
