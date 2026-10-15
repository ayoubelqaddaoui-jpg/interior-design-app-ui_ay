import { create } from 'zustand';
import { Platform } from 'react-native';
import type { AppUser } from '@/data/types';
import { api, backendEnabled, BackendError } from '@/lib/backend';

/** User authentication never touches useLocal.adminSession or its secure-store key. */
export const useUserSession = create<{
  user: AppUser | null;
  refresh(): Promise<void>;
  login(name: string, phone: string): Promise<AppUser>;
  logout(): Promise<void>;
}>((set) => ({
  user: null,
  async refresh() {
    if (!backendEnabled) return;
    try { set({ user: (await api<{ user: AppUser }>('/user/session')).user }); }
    catch (error) { if (error instanceof BackendError && error.status === 401) set({ user: null }); }
  },
  async login(name, phone) {
    const result = await api<{ user: AppUser; token?: string }>('/user/login', { method: 'POST', body: { name, phone } });
    if (Platform.OS !== 'web' && result.token) await (await import('expo-secure-store')).setItemAsync('dwira-user-session', result.token);
    set({ user: result.user });
    return result.user;
  },
  async logout() {
    // Do not claim success on an offline failure: the server session must be revoked.
    await api('/user/logout', { method: 'POST', body: {} });
    if (Platform.OS !== 'web') await (await import('expo-secure-store')).deleteItemAsync('dwira-user-session');
    set({ user: null });
  },
}));
