import { create } from 'zustand';
import { storage } from '@/data/mock/storage';

/** Device-local preferences (not admin data). */
interface Local {
  loaded: boolean;
  notifications: boolean;
  bannerDismissed: boolean;
  adminSession: boolean;
  load(): Promise<void>;
  set(p: Partial<Pick<Local, 'notifications' | 'bannerDismissed' | 'adminSession'>>): void;
}
export const useLocal = create<Local>((set, get) => ({
  loaded: false,
  notifications: false,
  bannerDismissed: false,
  adminSession: false,
  async load() {
    const v = await storage.read<Partial<Local>>('local');
    set({ ...(v ?? {}), loaded: true });
  },
  set(p) {
    set(p);
    const { notifications, bannerDismissed, adminSession } = get();
    storage.write('local', { notifications, bannerDismissed, adminSession });
  },
}));
