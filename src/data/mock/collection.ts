import type { CollectionRepo, DocRepo } from '../repositories/types';
import { storage } from './storage';
import { uid } from '@/lib/uid';

/** In-memory + AsyncStorage collection. Seed is used the first time only. */
export function createMockCollection<T extends { id: string }>(name: string, seed: () => T[]): CollectionRepo<T> {
  let cache: T[] | null = null;
  const load = async () => {
    if (cache) return cache;
    cache = (await storage.read<T[]>(name)) ?? seed();
    return cache;
  };
  const save = async () => {
    await storage.write(name, cache);
  };
  return {
    list: async () => [...(await load())],
    get: async (id) => (await load()).find((x) => x.id === id),
    async create(input) {
      const all = await load();
      const item = { ...input, id: input.id ?? uid(name.slice(0, 3)) } as T;
      all.push(item);
      await save();
      return item;
    },
    async update(id, patch) {
      const all = await load();
      const i = all.findIndex((x) => x.id === id);
      if (i < 0) throw new Error(`${name}/${id} not found`);
      all[i] = { ...all[i], ...patch };
      await save();
      return all[i];
    },
    async remove(id) {
      cache = (await load()).filter((x) => x.id !== id);
      await save();
    },
    async removeMany(ids) {
      const s = new Set(ids);
      cache = (await load()).filter((x) => !s.has(x.id));
      await save();
    },
  };
}

/** Stored documents are merged over the seed so settings added in later versions get their defaults. */
const withDefaults = <T,>(seed: T, stored: T | undefined): T =>
  stored && seed && typeof seed === 'object' && !Array.isArray(seed) ? { ...seed, ...stored } : stored ?? seed;

export function createMockDoc<T>(name: string, seed: () => T): DocRepo<T> {
  let cache: T | null = null;
  const load = async () => (cache ??= withDefaults(seed(), await storage.read<T>('doc:' + name)));
  return {
    get: load,
    async set(v) {
      cache = v;
      await storage.write('doc:' + name, v);
      return v;
    },
    async patch(p) {
      cache = { ...(await load()), ...p };
      await storage.write('doc:' + name, cache);
      return cache;
    },
  };
}
