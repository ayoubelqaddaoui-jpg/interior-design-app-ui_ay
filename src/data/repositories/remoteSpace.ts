import type { CollectionRepo } from './types';
import type { AppUser, Conversation, HistoryItem } from '@/data/types';
import { api, BackendError } from '@/lib/backend';
import { useUserSession } from '@/store/useUserSession';
import { useLocal } from '@/store/useLocal';

/** User spaces are server-authorized by the user session, never by device fingerprints. */
export function remoteSpace<T extends HistoryItem | Conversation>(kind: 'history' | 'conversations', guest: CollectionRepo<T>): CollectionRepo<T> {
  const active = () => !!useUserSession.getState().user;
  return {
    list: () => active() ? api<T[]>(`/user/${kind}`) : guest.list(),
    get: id => active() ? api<T>(`/user/${kind}/${encodeURIComponent(id)}`) : guest.get(id),
    create: input => active() ? api<T>(`/user/${kind}`, { method: 'POST', body: input }) : guest.create(input),
    update: (id, patch) => active() ? api<T>(`/user/${kind}/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }) : guest.update(id, patch),
    async remove(id) { if (active()) await api(`/user/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' }); else await guest.remove(id); },
    async removeMany(ids) { for (const id of ids) await this.remove(id); },
  };
}

/**
 * A visitor who has not signed in still has real conversations: they are stored in the database under the secret device
 * token (no name, no phone). When that person signs in, the server moves every one of them into their account.
 */
export function guestConversations(): CollectionRepo<Conversation> {
  const call = <R,>(path: string, method = 'GET', body?: unknown) => api<R>(`/guest/conversations${path}`, { method, body, client: true });
  return {
    list: () => call<Conversation[]>(''),
    get: id => call<Conversation>(`/${encodeURIComponent(id)}`),
    create: input => call<Conversation>('', 'POST', input),
    update: (id, patch) => call<Conversation>(`/${encodeURIComponent(id)}`, 'PATCH', patch),
    async remove(id) { await call(`/${encodeURIComponent(id)}`, 'DELETE'); },
    async removeMany(ids) { for (const id of ids) await this.remove(id); },
  };
}

/** Server clients have UUID ids. */
export const isClientId = (id: string) => /^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(id);

/** Users are the clients stored in the database; only an admin session can list or edit them. */
export function remoteUsers(): CollectionRepo<AppUser> {
  return {
    async list() {
      if (!useLocal.getState().adminSession) return [];
      try { return await api<AppUser[]>('/admin/clients'); }
      catch (error) {
        if (error instanceof BackendError && error.status === 401 && !useLocal.getState().adminOffline) useLocal.getState().set({ adminSession: false });
        else if (!(error instanceof BackendError)) throw error;
        return [];
      }
    },
    get: async id => (await api<AppUser[]>('/admin/clients')).find(row => row.id === id),
    create: async () => { throw new BackendError(405, 'CLIENTS_SIGN_UP_THEMSELVES'); },
    async update(id, patch) {
      // Only the fields an admin may change are sent; the server validates them again.
      const body: { credits?: number; blocked?: boolean } = {};
      if (patch.credits !== undefined) body.credits = patch.credits;
      if (patch.blocked !== undefined) body.blocked = patch.blocked;
      const row = await api<AppUser>(`/admin/clients/${encodeURIComponent(id)}`, { method: 'PATCH', body });
      if (useUserSession.getState().user?.id === id) useUserSession.setState({ user: row });
      return row;
    },
    remove: async id => { await api(`/admin/clients/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
    async removeMany(ids) { if (ids.length) await api('/admin/clients/bulk', { method: 'POST', body: { ids, action: 'delete' } }); },
  };
}
