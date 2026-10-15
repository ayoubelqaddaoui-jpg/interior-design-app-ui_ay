import { create } from 'zustand';
import { uid } from '@/lib/uid';
import type { Draft } from '@/data/types';

interface Wizard {
  claimId: string;
  uploadId?: string;
  requestId?: string;
  proSeen: boolean;
  dirty: boolean;
  clear(): void;
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
  claimId: uid('claim'), proSeen: false, dirty: false,
  clear: () => set({ photoUri: '', draft: { toolId: '' }, toolId: '', dirty: false, lead: undefined, uploadId: undefined, requestId: undefined, proSeen: false }),
  toolId: '',
  photoUri: '',
  draft: { toolId: '' },
  start: (toolId, preset) => set({ toolId, photoUri: '', lead: undefined, claimId: uid('claim'), uploadId: undefined, requestId: undefined, proSeen: false, dirty: false, draft: { toolId, ...preset } }),
  setPhoto: (photoUri) => set({ photoUri, dirty: !!photoUri }),
  patch: (p) => set((s) => ({ draft: { ...s.draft, ...p }, dirty: true })),
  setLead: (lead) => set({ lead }),
}));
