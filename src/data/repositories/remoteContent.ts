import type { CollectionRepo, DocRepo } from './types';
import type { CollName, CollMap, DocMap, DocName } from '@/data/types';
import { api } from '@/lib/backend';
import { uid } from '@/lib/uid';

/** Everything an admin edits (collections + settings documents) lives in the database; this is the only reader/writer. */
interface Snapshot { version: number; collections: Record<string, { id: string }[]>; docs: Record<string, unknown> }

let inflight: Promise<Snapshot> | null = null;
let current: Snapshot | null = null;
let fetchedAt = 0;
/** Version of the last snapshot received; the sync loop compares it with the server counter. */
export const contentVersion = () => current?.version ?? -1;
/** Time of the last local write; a snapshot fetched before it is stale and must not replace the store. */
let lastWrite = 0;
export const lastContentWrite = () => lastWrite;

/** Parallel reads (init loads 13 repos at once) share one request. */
export function contentSnapshot(force = true): Promise<Snapshot> {
  if (inflight) return inflight;
  if (!force && current && Date.now() - fetchedAt < 2000) return Promise.resolve(current);
  inflight = api<Snapshot>('/content').then(snapshot => { current = snapshot; fetchedAt = Date.now(); return snapshot; }).finally(() => { inflight = null; });
  return inflight;
}

export function remoteCollection<K extends CollName>(name: K): CollectionRepo<CollMap[K]> {
  type T = CollMap[K];
  const rows = async (force = false) => ((await contentSnapshot(force)).collections[name] ?? []) as T[];
  const put = async (item: T) => {
    lastWrite = Date.now();
    const saved = await api<T>(`/admin/content/${name}/${encodeURIComponent(item.id)}`, { method: 'PUT', body: item });
    lastWrite = Date.now();
    if (current) {
      const list = (current.collections[name] ??= []) as T[];
      const index = list.findIndex(row => row.id === saved.id);
      if (index >= 0) list[index] = saved; else list.push(saved);
    }
    return saved;
  };
  return {
    list: async () => [...await rows()],
    get: async id => (await rows()).find(row => row.id === id),
    create: input => put({ ...input, id: input.id ?? uid(name.slice(0, 3)) } as T),
    async update(id, patch) {
      // Merge over the freshest stored row; bursts (reordering) reuse the snapshot fetched moments ago.
      const old = (await rows()).find(row => row.id === id);
      if (!old) throw new Error(`${name}/${id} not found`);
      return put({ ...old, ...patch, id });
    },
    remove: id => remove([id]),
    removeMany: ids => remove(ids),
  };
  async function remove(ids: string[]) {
    if (!ids.length) return;
    lastWrite = Date.now();
    await api(`/admin/content/${name}`, { method: 'DELETE', body: { ids } });
    lastWrite = Date.now();
    if (current) current.collections[name] = (current.collections[name] ?? []).filter(row => !ids.includes(row.id));
  }
}

export function remoteDoc<K extends DocName>(name: K, defaults: () => DocMap[K]): DocRepo<DocMap[K]> {
  type T = DocMap[K];
  // Stored values are merged over the defaults so settings added in later versions get a value.
  const withDefaults = (stored: unknown) => ({ ...defaults(), ...(stored as object | undefined) }) as T;
  const patch = async (value: Partial<T>) => {
    lastWrite = Date.now();
    const saved = withDefaults(await api<T>(`/admin/doc/${name}`, { method: 'PATCH', body: value }));
    lastWrite = Date.now();
    if (current) current.docs[name] = saved;
    return saved;
  };
  return {
    get: async () => withDefaults((await contentSnapshot(false)).docs[name]),
    set: value => patch(value),
    patch,
  };
}
