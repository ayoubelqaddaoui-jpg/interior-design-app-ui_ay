import type { AppUser } from '@/data/types';
import { useUserSession } from '@/store/useUserSession';
import { useWizard } from '@/store/useWizard';

/** The paywall is only for people who used their free design AND have no credits left. */
export const needsPro = (user?: Pick<AppUser, 'freeUsed' | 'credits'> | null) => !!user?.freeUsed && (user.credits ?? 0) <= 0;

/**
 * Fetches the latest credits from the server (the admin may have granted some since this device last looked)
 * and returns the fresh user. Falls back to the cached one when offline.
 */
export async function freshUser(): Promise<AppUser | null> {
  await useUserSession.getState().refresh();
  return useUserSession.getState().user;
}

/** Credits are available: skip the paywall for this generation. */
export const clearPaywall = () => useWizard.setState({ proSeen: true });
