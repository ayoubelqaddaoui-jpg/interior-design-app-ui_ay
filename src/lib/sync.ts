import { AppState, Platform } from 'react-native';
import type { UserPrefs } from '@/data/types';
import { api, backendEnabled, BackendError } from '@/lib/backend';
import { contentVersion } from '@/data/repositories/remoteContent';
import { onLangChosen, useLang } from '@/i18n';
import { reconcileDevice, syncLanguage } from '@/lib/notifications';
import { reloadUserSpace, useStore } from '@/store/useStore';
import { useLocal } from '@/store/useLocal';
import { usePrefs } from '@/store/usePrefs';
import { useUserSession } from '@/store/useUserSession';

/** What `GET /api/sync` returns: one monotonically increasing version per kind of data (null = not visible to this session). */
interface SyncState { content: number; requests: number | null; clients: number | null; admin: number | null; client: number | null; user: { id: string; blocked: boolean } | null; isAdmin: boolean }
const POLL_MS = 4000;

type Seen = Partial<Record<'content' | 'requests' | 'clients' | 'admin' | 'client', number | null>>;
let seen: Seen = {};
let identity = '';
let running = false;

/** Loads the admin's saved preferences (also proves the stored admin session is still valid on the server). */
export async function refreshAdminSession() {
  const local = useLocal.getState();
  if (!backendEnabled || !local.adminSession || local.adminOffline) return;
  try {
    const result = await api<{ ok: true; prefs?: UserPrefs }>('/admin/session');
    usePrefs.getState().hydrate('admin', result.prefs ?? {});
  } catch (error) {
    if (error instanceof BackendError && error.status === 401) { useLocal.getState().set({ adminSession: false }); usePrefs.getState().clear('admin'); }
  }
}

/** One sync round: compare versions and reload only what changed, on every device, for every signed-in role. */
export async function syncOnce() {
  if (!backendEnabled || running) return;
  running = true;
  try {
    const state = await api<SyncState>('/sync', { client: true });
    const store = useStore.getState();
    const local = useLocal.getState();
    const session = useUserSession.getState();
    // A different person on this device: forget what the previous one had already seen.
    const now = `${local.adminSession && state.isAdmin ? 'a' : ''}:${session.user?.id ?? ''}`;
    if (now !== identity) { identity = now; seen = { content: seen.content }; }
    const changed = (key: keyof Seen) => { const was = seen[key]; seen[key] = state[key]; return was !== undefined && was !== state[key] && state[key] != null; };
    // The first round compares against the snapshot the app booted with, so a change made in between is not lost.
    if (seen.content === undefined) seen.content = contentVersion();
    const jobs: Promise<unknown>[] = [];

    if (changed('content')) jobs.push(store.reloadContent());
    // The server forgot the admin session (expired / signed out elsewhere): leave the admin panel.
    if (local.adminSession && !local.adminOffline && !state.isAdmin) { useLocal.getState().set({ adminSession: false }); usePrefs.getState().clear('admin'); }
    if (state.isAdmin && local.adminSession) {
      if (changed('requests')) jobs.push(store.reload('requests'));
      if (changed('clients')) jobs.push(store.reload('users'));
      if (changed('admin')) jobs.push(refreshAdminSession());
    }
    if (session.user) {
      if (state.user?.blocked) jobs.push(session.refresh()); // signs this device out
      else if (changed('client')) jobs.push(session.refresh().then(reloadUserSpace));
    } else if (state.client != null) {
      // The server recognises a client session this device has not loaded (signed in from the cookie).
      jobs.push(session.refresh().then(reloadUserSpace));
    }
    await Promise.allSettled(jobs);
  } catch { /* offline or server restarting: try again on the next tick */ }
  finally { running = false; }
}

/** Starts polling while the app is visible; returns the stop function. Websockets are unavailable on serverless hosting, so this is the real-time channel. */
export function startSync() {
  if (!backendEnabled) return () => {};
  void refreshAdminSession();
  const tick = () => { void syncOnce(); };
  const timer = setInterval(() => { if (Platform.OS !== 'web' || typeof document === 'undefined' || !document.hidden) tick(); }, POLL_MS);
  const wake = () => { if (typeof document === 'undefined' || !document.hidden) tick(); };
  if (Platform.OS === 'web' && typeof document !== 'undefined') { document.addEventListener('visibilitychange', wake); window.addEventListener('focus', wake); window.addEventListener('online', wake); }
  const app = Platform.OS === 'web' ? null : AppState.addEventListener('change', s => { if (s === 'active') tick(); });
  tick();
  return () => {
    clearInterval(timer);
    if (Platform.OS === 'web' && typeof document !== 'undefined') { document.removeEventListener('visibilitychange', wake); window.removeEventListener('focus', wake); window.removeEventListener('online', wake); }
    app?.remove();
  };
}

/** Wires language choices and notification defaults to the database-backed preferences. Call once at startup. */
export function startPreferenceBindings() {
  // A language chosen on this device is saved for every identity that is signed in on it.
  const stopLang = onLangChosen(lang => {
    const signedIn = { client: !!useUserSession.getState().user, admin: useLocal.getState().adminSession && !useLocal.getState().adminOffline };
    void usePrefs.getState().saveEverywhere({ lang }, signedIn);
    if (signedIn.client) void syncLanguage('client', lang);
    if (signedIn.admin) void syncLanguage('admin', lang);
  });
  // Default notifications: whenever the preferences or the identity change, make this device match the saved setting.
  const run = () => {
    const lang = useLang.getState().lang;
    void reconcileDevice('client', lang);
    void reconcileDevice('admin', lang);
  };
  const unsubscribe = [usePrefs.subscribe(run), useUserSession.subscribe((s, p) => { if (s.user?.id !== p.user?.id) run(); }), useLocal.subscribe((s, p) => { if (s.adminSession !== p.adminSession) run(); })];
  run();
  return () => { stopLang(); unsubscribe.forEach(fn => fn()); };
}
