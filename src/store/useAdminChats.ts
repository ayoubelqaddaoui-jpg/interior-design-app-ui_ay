import { create } from 'zustand';
import type { Conversation } from '@/data/types';
import { api, backendEnabled } from '@/lib/backend';
import { useLocal } from '@/store/useLocal';

/** A client's conversation as the admin sees it (with who wrote it). */
export type AdminConversation = Conversation & { clientName: string; whatsapp: string };

/** Admin inbox: every client's assistant conversations. Loaded on demand and whenever the server announces a `chats` change. */
export const useAdminChats = create<{
  chats: AdminConversation[];
  loaded: boolean;
  load(): Promise<void>;
  reply(id: string, text: string): Promise<void>;
  clear(): void;
}>((set, get) => ({
  chats: [],
  loaded: false,
  async load() {
    if (!backendEnabled || !useLocal.getState().adminSession) return;
    set({ chats: await api<AdminConversation[]>('/admin/conversations'), loaded: true });
  },
  async reply(id, text) {
    const updated = await api<AdminConversation>(`/admin/conversations/${encodeURIComponent(id)}`, { method: 'POST', body: { text } });
    set({ chats: [updated, ...get().chats.filter(chat => chat.id !== id)] });
  },
  clear: () => set({ chats: [], loaded: false }),
}));
