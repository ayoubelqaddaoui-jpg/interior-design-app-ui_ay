import type { Lang } from '@/data/types';
import { api, backendEnabled } from './backend';

export type PushStatus = 'enabled' | 'disabled' | 'blocked' | 'unsupported' | 'unconfigured';
const supported = () => typeof window !== 'undefined' && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function keyBytes(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(decoded, char => char.charCodeAt(0));
}
async function registration() {
  const registered = await navigator.serviceWorker.register('/push-sw.js', { scope: '/', updateViaCache: 'none' });
  if (registered.active) return registered;
  return navigator.serviceWorker.ready;
}
export async function pushStatus(): Promise<PushStatus> {
  if (!backendEnabled) return 'unconfigured';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const worker = await navigator.serviceWorker.getRegistration('/');
  return worker && await worker.pushManager.getSubscription() ? 'enabled' : 'disabled';
}
export async function enablePush(language: Lang): Promise<PushStatus> {
  if (!backendEnabled || !supported()) return pushStatus();
  // Ask only from a user button press, never on mount or a language change.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'disabled';
  const config = await api<{ publicKey: string | null }>('/push/config');
  if (!config.publicKey) return 'unconfigured';
  const worker = await registration();
  let subscription = await worker.pushManager.getSubscription();
  const expected = keyBytes(config.publicKey);
  const existing = subscription?.options.applicationServerKey;
  if (subscription && existing && Array.from(new Uint8Array(existing)).join(',') !== Array.from(expected).join(',')) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ||= await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: expected });
  // Subscription is only considered enabled when persisted by the authenticated backend.
  await api('/push/subscriptions', { method: 'POST', body: { kind: 'web', subscription: subscription.toJSON(), language } });
  return 'enabled';
}
export async function syncPushLanguage(language: Lang) {
  if (!backendEnabled || !supported() || Notification.permission !== 'granted') return;
  const worker = await navigator.serviceWorker.getRegistration('/');
  const subscription = await worker?.pushManager.getSubscription();
  if (subscription) await api('/push/subscriptions', { method: 'POST', body: { kind: 'web', subscription: subscription.toJSON(), language } });
}
export async function disablePush() {
  if (!supported()) return;
  const worker = await navigator.serviceWorker.getRegistration('/');
  const subscription = await worker?.pushManager.getSubscription();
  if (!subscription) return;
  try { await api('/push/subscriptions', { method: 'DELETE', body: { kind: 'web', subscription: subscription.toJSON() } }); }
  finally { await subscription.unsubscribe(); }
}
