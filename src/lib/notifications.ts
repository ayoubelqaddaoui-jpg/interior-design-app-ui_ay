import { create } from 'zustand';
import type { Lang } from '@/data/types';
import { backendEnabled } from '@/lib/backend';
import { disablePush, enablePush, pushGranted, pushStatus, syncPushLanguage, type PushOwner, type PushStatus } from '@/lib/push';
import { useLocal } from '@/store/useLocal';
import { usePrefs } from '@/store/usePrefs';
import { useUserSession } from '@/store/useUserSession';

/** State of THIS device's push subscription (the choice itself is stored per person in the database). */
export const useDevicePush = create<{ status: PushStatus; refresh(): Promise<void> }>((set) => ({
  status: 'disabled',
  async refresh() { set({ status: await pushStatus().catch(() => 'unsupported' as PushStatus) }); },
}));

/** Status as one person sees it: a shared browser subscription counts as "off" for someone who switched notifications off. */
export function useOwnerPushStatus(owner: PushOwner): PushStatus {
  const status = useDevicePush(s => s.status);
  const off = usePrefs(s => s[owner === 'client' ? 'client' : 'admin']?.notifications === false);
  return status === 'enabled' && off ? 'disabled' : status;
}
/** Another signed-in identity on this device that still wants this browser subscription. */
const otherWantsDevice = (owner: PushOwner) => {
  const other: PushOwner = owner === 'client' ? 'admin' : 'client';
  return signedIn(other) && usePrefs.getState()[scopeOf(other)]?.notifications !== false;
};

const scopeOf = (owner: PushOwner) => (owner === 'client' ? 'client' : 'admin');
const signedIn = (owner: PushOwner) => (owner === 'client' ? !!useUserSession.getState().user : useLocal.getState().adminSession && !useLocal.getState().adminOffline);

/**
 * Default behaviour: whenever this device already has notification permission and the person's saved setting
 * is not "off", subscribe the device silently (never a prompt). If the saved setting is "off" (set on any
 * device), stop this device's notifications for that person.
 */
const reconciled: Record<PushOwner, string> = { admin: '', client: '' };
export async function reconcileDevice(owner: PushOwner, language: Lang) {
  if (!backendEnabled || !signedIn(owner)) { reconciled[owner] = ''; return; }
  const prefs = usePrefs.getState()[scopeOf(owner)];
  if (!prefs) return; // preferences not loaded yet: never guess
  // Only act when something relevant changed (person, saved setting, language), not on every sync tick.
  const key = `${owner === 'client' ? useUserSession.getState().user?.id : 'admin'}:${prefs.notifications}:${language}`;
  if (reconciled[owner] === key) return;
  reconciled[owner] = key;
  if (prefs.notifications === false) { await disablePush(owner, otherWantsDevice(owner)).catch(() => {}); }
  else if (await pushGranted().catch(() => false)) await enablePush(language, owner, false).catch(() => {});
  await useDevicePush.getState().refresh();
}

/** From a tap: asks the browser/OS for permission if needed, subscribes this device, and saves the choice in the database. */
export async function setNotifications(owner: PushOwner, on: boolean, language: Lang): Promise<PushStatus> {
  if (!on) {
    await disablePush(owner, otherWantsDevice(owner)).catch(() => {});
    await usePrefs.getState().save(scopeOf(owner), { notifications: false, bannerDismissed: true });
    await useDevicePush.getState().refresh();
    return 'disabled';
  }
  // Keep the permission request as the first await so it still counts as part of the user's tap.
  const status = await enablePush(language, owner);
  if (status === 'enabled') await usePrefs.getState().save(scopeOf(owner), { notifications: true, bannerDismissed: true });
  await useDevicePush.getState().refresh();
  return status;
}

/** Called on sign-out: this device no longer receives that person's notifications. */
export async function releaseDevice(owner: PushOwner) {
  reconciled[owner] = '';
  if (!backendEnabled) return;
  await disablePush(owner, otherWantsDevice(owner));
  await useDevicePush.getState().refresh();
}

/** Keeps existing opt-ins in the person's language. */
export function syncLanguage(owner: PushOwner, language: Lang) {
  return syncPushLanguage(language, owner).catch(() => {});
}
