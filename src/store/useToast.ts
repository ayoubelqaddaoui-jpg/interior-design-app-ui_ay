import { create } from 'zustand';

interface ToastState { msg: string; id: number; show(m: string): void }
export const useToast = create<ToastState>((set) => ({
  msg: '', id: 0,
  show: (msg) => set((s) => ({ msg, id: s.id + 1 })),
}));
export const toast = (m: string) => useToast.getState().show(m);
