import { create } from 'zustand';
import type { CollMap, CollName, DocMap, DocName, AppUser } from '@/data/types';
import { repos, docs, ME } from '@/data/repositories';
import { moveSelection } from '@/lib/reorder';
import { uid } from '@/lib/uid';
import { defaultAssistant, defaultBranding, defaultSettings, defaultTheme, seedPalettes } from '@/data/mock/seed';
import { storage } from '@/data/mock/storage';

type Colls = { [K in CollName]: CollMap[K][] };

interface State extends Colls {
  doc: DocMap;
  ready: boolean;
  init(): Promise<void>;
  reload(name: CollName): Promise<void>;
  create<K extends CollName>(name: K, input: Omit<CollMap[K], 'id'> & { id?: string }): Promise<CollMap[K]>;
  update<K extends CollName>(name: K, id: string, patch: Partial<CollMap[K]>): Promise<void>;
  remove(name: CollName, id: string): Promise<void>;
  removeMany(name: CollName, ids: string[]): Promise<void>;
  patchDoc<K extends DocName>(name: K, patch: Partial<DocMap[K]>): Promise<void>;
  /** Reorder helper for any collection with `order`. */
  move(name: CollName, id: string, dir: -1 | 1): Promise<void>;
  moveMany(name: CollName, ids: string[], dir: -1 | 1): Promise<void>;
}

const empty: Colls = {
  tabs: [], tools: [], roomTypes: [], styles: [], palettes: [], sections: [], categories: [],
  inspirations: [], models: [], users: [], requests: [], history: [], conversations: [],
};
let initializing: Promise<void> | null = null;
const COLLS = Object.keys(empty) as CollName[];

/** One shared store: user app and admin panel read/write the same state, so changes appear instantly. */
export const useStore = create<State>((set, get) => ({
  ...empty,
  doc: { branding: defaultBranding(), theme: defaultTheme(), assistant: defaultAssistant(), settings: defaultSettings() },
  ready: false,
  async init() {
    if (get().ready) return;
    if (initializing) return initializing;
    initializing = (async () => {
    // Start independent reads together rather than serializing startup behind migration.
    const listsPromise = Promise.all(COLLS.map((c) => repos[c].list()));
    const docsPromise = Promise.all([docs.branding.get(), docs.theme.get(), docs.assistant.get(), docs.settings.get()]);
    // One-time upgrade: preserve existing edits/order and never resurrect deleted presets.
    if (!await storage.read<boolean>('migration:curated-palettes-v2')) {
      const palettes = await repos.palettes.list();
      const curated = seedPalettes().filter((p) => !['pal_surprise', 'pal_neutral', 'pal_earth', 'pal_blue', 'pal_pastel', 'pal_green'].includes(p.id));
      let order = palettes.length ? Math.max(...palettes.map((p) => p.order)) + 1 : 0;
      for (const palette of curated) if (!palettes.some((p) => p.id === palette.id)) await repos.palettes.create({ ...palette, order: order++ });
      await storage.write('migration:curated-palettes-v2', true);
    }
    const lists = await listsPromise;
    // Include newly migrated palettes without re-reading unrelated collections.
    lists[COLLS.indexOf('palettes')] = await repos.palettes.list();
    const [branding, theme, assistant, settings] = await docsPromise;
    const patch: Record<string, unknown> = {};
    COLLS.forEach((c, i) => (patch[c] = lists[i]));
    set({ ...(patch as Colls), doc: { branding, theme, assistant, settings }, ready: true });
    })().finally(() => { initializing = null; });
    return initializing;
  },
  async reload(name) {
    set({ [name]: await repos[name].list() } as Partial<State>);
  },
  async create(name, input) {
    const item = await (repos[name] as any).create(input);
    set({ [name]: [...(get()[name] as any[]), item] } as Partial<State>);
    return item;
  },
  async update(name, id, p) {
    const item = await (repos[name] as any).update(id, p);
    set({ [name]: (get()[name] as any[]).map((x) => (x.id === id ? item : x)) } as Partial<State>);
  },
  async remove(name, id) {
    await repos[name].remove(id);
    set({ [name]: (get()[name] as any[]).filter((x) => x.id !== id) } as Partial<State>);
  },
  async removeMany(name, ids) {
    await repos[name].removeMany(ids);
    const s = new Set(ids);
    set({ [name]: (get()[name] as any[]).filter((x) => !s.has(x.id)) } as Partial<State>);
  },
  async patchDoc(name, p) {
    const v = await (docs[name] as any).patch(p);
    set({ doc: { ...get().doc, [name]: v } });
  },
  async move(name, id, dir) {
    await get().moveMany(name, [id], dir);
  },
  async moveMany(name, ids, dir) {
    const list = sorted(get()[name] as any[]);
    const reordered = moveSelection(list, ids, dir);
    for (let i = 0; i < reordered.length; i++) {
      if (reordered[i].order !== i) await get().update(name, reordered[i].id, { order: i } as any);
    }
  },
}));

export const sorted = <T extends { order: number }>(a: T[]) => [...a].sort((x, y) => x.order - y.order);
export const nextOrder = (a: { order: number }[]) => (a.length ? Math.max(...a.map((x) => x.order)) + 1 : 0);

/** Current (single, device-local) end user. */
export const useMe = (): AppUser | undefined => useStore((s) => s.users.find((u) => u.id === ME));
export { uid };
