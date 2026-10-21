import { create } from 'zustand';
import type { UserPrefs } from '@/data/types';
import { api, backendEnabled } from '@/lib/backend';
import { useLang, LANGS } from '@/i18n';
import { useLocal } from '@/store/useLocal';

export type PrefScope = 'client' | 'admin';
const path = (scope: PrefScope) => (scope === 'admin' ? '/prefs?as=admin' : '/prefs');

/**
 * Notification, banner and language preferences. The database is the source of truth, one row per client and
 * one per admin, so the same choices follow the person to every device. The values are only cached here.
 */
interface Prefs {
  client: UserPrefs | null;
  admin: UserPrefs | null;
  /** Accept preferences read from the server (login, session check, sync). */
  hydrate(scope: PrefScope, prefs: UserPrefs | null | undefined): void;
  /** Optimistic local update followed by a database write. */
  save(scope: PrefScope, patch: UserPrefs): Promise<void>;
  clear(scope: PrefScope): void;
  /** Persists to every identity signed in on this device (client and/or admin). */
  saveEverywhere(patch: UserPrefs, signedIn: { client: boolean; admin: boolean }): Promise<void>;
}

const pending: Record<PrefScope, number> = { client: 0, admin: 0 };
const apply = (prefs: UserPrefs) => {
  if (prefs.lang && LANGS.includes(prefs.lang) && prefs.lang !== useLang.getState().lang) useLang.getState().set(prefs.lang, false);
};

export const usePrefs = create<Prefs>((set, get) => ({
  client: null,
  admin: null,
  hydrate(scope, prefs) {
    // A save in flight is newer than whatever the server sent a moment ago.
    if (!prefs || pending[scope] > 0) return;
    set({ [scope]: prefs } as Partial<Prefs>);
    // The person's saved language wins; a first sign-in adopts the language currently shown on this device.
    if (prefs.lang) apply(prefs);
    else void get().save(scope, { lang: useLang.getState().lang });
  },
  async save(scope, patch) {
    set({ [scope]: { ...(get()[scope] ?? {}), ...patch } } as Partial<Prefs>);
    if (!backendEnabled) return;
    if (scope === 'admin' && useLocal.getState().adminOffline) return;
    pending[scope]++;
    try { set({ [scope]: await api<UserPrefs>(path(scope), { method: 'PATCH', body: patch }) } as Partial<Prefs>); } catch { /* kept locally; the next sign-in re-reads the stored values */ }
    finally { pending[scope]--; }
  },
  clear(scope) { set({ [scope]: null } as Partial<Prefs>); },
  async saveEverywhere(patch, signedIn) {
    await Promise.all([signedIn.client ? get().save('client', patch) : null, signedIn.admin ? get().save('admin', patch) : null]);
  },
}));
