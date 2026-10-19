import { create } from 'zustand';
import { storage } from '@/data/mock/storage';

/** Device-local preferences (not admin data). */
interface Local {
  loaded: boolean;
  notifications: boolean;
  bannerDismissed: boolean;
  adminSession: boolean;
  /** True when the built-in admin/admin login was accepted locally because the API could not confirm it. */
  adminOffline: boolean;
  load(): Promise<void>;
  set(p: Partial<Pick<Local, 'notifications' | 'bannerDismissed' | 'adminSession' | 'adminOffline'>>): void;
}
export const useLocal = create<Local>((set, get) => ({
  loaded: false,
  notifications: false,
  bannerDismissed: false,
  adminSession: false,
  adminOffline: false,
  async load() {
    const v = await storage.read<Partial<Local>>('local');
    set({ ...(v ?? {}), loaded: true });
  },
  set(p) {
    set(p);
    const { notifications, bannerDismissed, adminSession, adminOffline } = get();
    storage.write('local', { notifications, bannerDismissed, adminSession, adminOffline });
  },
}));
