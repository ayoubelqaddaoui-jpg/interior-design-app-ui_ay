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

/** Keep seed/admin records and their existing logic, but route real client credit grants to the backend. */
export function remoteUsers(local: CollectionRepo<AppUser>): CollectionRepo<AppUser> {
  const remote = new Set<string>();
  return {
    ...local,
    async list() {
      const rows = await local.list();
      if (!useLocal.getState().adminSession) return rows;
      let clients: AppUser[];
      try { clients = await api<AppUser[]>('/admin/clients'); }
      catch (error) { if (error instanceof BackendError && error.status === 401) { useLocal.getState().set({ adminSession: false }); return rows; } return rows; }
      clients.forEach(row => remote.add(row.id));
      return [...rows, ...clients];
    },
    async update(id, patch) {
      if (!remote.has(id)) return local.update(id, patch);
      const row = await api<AppUser>(`/admin/clients/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
      if (useUserSession.getState().user?.id === id) useUserSession.setState({ user: row });
      return row;
    },
  };
}
