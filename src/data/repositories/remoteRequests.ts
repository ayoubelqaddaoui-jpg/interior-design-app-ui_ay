import type { CollectionRepo } from './types';
import type { RenderRequest } from '@/data/types';
import { api, BackendError } from '@/lib/backend';
import { useLocal } from '@/store/useLocal';
import { uid } from '@/lib/uid';

/** Only demands opt into the backend; every other repository remains unchanged. */
export function remoteRequests(local: CollectionRepo<RenderRequest>): CollectionRepo<RenderRequest> {
  const remoteIds = new Set<string>();
  const remember = async (item: RenderRequest) => {
    remoteIds.add(item.id);
    if (await local.get(item.id)) await local.update(item.id, item);
    else await local.create(item);
    return item;
  };
  const isRemote = (id: string) => remoteIds.has(id) || /^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(id);
  return {
    async list() {
      const cached = await local.list();
      if (!useLocal.getState().adminSession) return cached;
      try {
        const rows = await api<RenderRequest[]>('/requests');
        rows.forEach(row => remoteIds.add(row.id));
        // Keep existing mock/local records, but never resurrect a deleted remote demand.
        return [...cached.filter(row => !isRemote(row.id)), ...rows];
      } catch (error) {
        if (error instanceof BackendError && error.status === 401) useLocal.getState().set({ adminSession: false });
        return cached;
      }
    },
    async get(id) {
      if (!isRemote(id)) return local.get(id);
      return remember(await api<RenderRequest>(`/requests/${encodeURIComponent(id)}`, { client: true }));
    },
    async create(input) {
      // Stable ID supplied by the lead form makes retries idempotent after a lost response.
      const row = await api<RenderRequest>('/requests', { method: 'POST', client: true, body: { ...input, id: input.id || uid('req') } });
      return remember(row);
    },
    async update(id, patch) {
      if (!isRemote(id)) return local.update(id, patch);
      return remember(await api<RenderRequest>(`/requests/${encodeURIComponent(id)}`, { method: 'PATCH', client: true, body: patch }));
    },
    async remove(id) {
      if (isRemote(id)) await api(`/requests/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await local.remove(id);
    },
    async removeMany(ids) { for (const id of ids) await this.remove(id); },
  };
}
