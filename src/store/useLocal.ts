import { create } from 'zustand';
import { storage } from '@/data/mock/storage';

/**
 * Device-local flags only. Notification, banner and language preferences are stored in the database per
 * person (see usePrefs); the admin session flags just remember that this device has a server session.
 */
interface Local {
  loaded: boolean;
  adminSession: boolean;
  /** True when the built-in admin/admin login was accepted locally because the API could not confirm it. */
  adminOffline: boolean;
  load(): Promise<void>;
  set(p: Partial<Pick<Local, 'adminSession' | 'adminOffline'>>): void;
}
export const useLocal = create<Local>((set, get) => ({
  loaded: false,
  adminSession: false,
  adminOffline: false,
  async load() {
    const v = await storage.read<Partial<Local>>('local');
    set({ adminSession: !!v?.adminSession, adminOffline: !!v?.adminOffline, loaded: true });
  },
  set(p) {
    set(p);
    const { adminSession, adminOffline } = get();
    storage.write('local', { adminSession, adminOffline });
  },
}));
