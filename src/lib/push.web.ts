import type { Lang } from '@/data/types';
import { api, backendEnabled } from './backend';

/** `install`: iPhone/iPad Safari only delivers web push to an app added to the Home Screen. */
export type PushStatus = 'enabled' | 'disabled' | 'blocked' | 'unsupported' | 'unconfigured' | 'install';

const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent);
const isIos = () => /iPad|iPhone|iPod/.test(ua()) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => (typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true));
const supported = () => typeof window !== 'undefined' && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(decoded, char => char.charCodeAt(0));
}
async function registration() {
  await navigator.serviceWorker.register('/push-sw.js', { scope: '/', updateViaCache: 'none' });
  // `ready` resolves once a worker controls the scope, including on the very first visit.
  return navigator.serviceWorker.ready;
}
export async function pushStatus(): Promise<PushStatus> {
  if (!backendEnabled) return 'unconfigured';
  if (!supported()) return isIos() && !standalone() ? 'install' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const worker = await navigator.serviceWorker.getRegistration('/');
  return worker && await worker.pushManager.getSubscription() ? 'enabled' : 'disabled';
}
/** Must be called from a tap/click handler. Throws a BackendError when the server is unreachable or the admin session is missing. */
export async function enablePush(language: Lang): Promise<PushStatus> {
  if (!backendEnabled || !supported()) return pushStatus();
  // Must be the first await: browsers (notably Safari) only show the prompt inside the user gesture.
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
  // Only "enabled" once the authenticated backend has stored it.
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
/** Sends a real notification through the server to every registered device. */
export async function sendTestPush() { return api<{ ok: boolean; devices: number }>('/push/test', { method: 'POST', body: {} }); }
