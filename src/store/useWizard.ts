import { create } from 'zustand';
import type { Draft } from '@/data/types';

interface Wizard {
  toolId: string;
  photoUri: string;
  draft: Draft;
  lead?: { name: string; whatsapp: string };
  /** history item produced by the last render (used by result page / regenerate) */
  start(toolId: string, preset?: Partial<Draft>): void;
  setPhoto(uri: string): void;
  patch(p: Partial<Draft>): void;
  setLead(l: Wizard['lead']): void;
}
export const useWizard = create<Wizard>((set) => ({
  toolId: '',
  photoUri: '',
  draft: { toolId: '' },
  start: (toolId, preset) => set({ toolId, photoUri: '', lead: undefined, draft: { toolId, ...preset } }),
  setPhoto: (photoUri) => set({ photoUri }),
  patch: (p) => set((s) => ({ draft: { ...s.draft, ...p } })),
  setLead: (lead) => set({ lead }),
}));
