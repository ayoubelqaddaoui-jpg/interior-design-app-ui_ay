import { create } from 'zustand';
import type { LText } from '@/data/types';
import { api, backendEnabled } from '@/lib/backend';
import { useLocal } from '@/store/useLocal';

export type Segment = 'all' | 'new' | 'existing' | 'inactive' | 'image_users' | 'no_image';
export const SEGMENTS: Segment[] = ['all', 'new', 'existing', 'inactive', 'image_users', 'no_image'];
export type CampaignKind = 'once' | 'recurring' | 'trigger';
export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'active' | 'paused' | 'ended';
export type TriggerEvent = 'signup' | 'first_design' | 'no_design' | 'inactive';
export type Freq = 'daily' | 'weekly' | 'monthly';
export interface Audience { segments: Segment[]; clientIds: string[]; newDays: number; inactiveDays: number }
export interface Trigger { event: TriggerEvent; delayMinutes: number; afterDays: number; cooldownDays: number; includeExisting: boolean; quiet: string | null; quietTo: string | null }
export interface Schedule { at?: number | null; tz?: string; freq?: Freq; time?: string; days?: number[]; dayOfMonth?: number; startAt?: number | null; endAt?: number | null }
export interface CampaignStats { total: number; sent: number; pending: number; skipped: number; failed: number; devices: number }
export interface Campaign {
  id: string; kind: CampaignKind; status: CampaignStatus; nextAt: number | null; createdAt: number; updatedAt: number;
  name: string; title: LText; body: LText; url: string; audience?: Audience; trigger?: Trigger; schedule?: Schedule;
  lastRunAt?: number; lastRunCount?: number; lastRunSkipped?: boolean; stats: CampaignStats;
  recent?: { status: string; devices: number; sentAt: number | null; reason: string | null; name: string }[];
}
/** What the composer sends (the server validates and normalises everything again). */
export interface CampaignInput { kind: CampaignKind; name: string; title: LText; body: LText; url: string; audience?: Partial<Audience>; trigger?: Record<string, unknown>; schedule?: Schedule }
export interface SegmentCount { matched: number; reachable: number }
export interface Person { id: string; name: string; whatsapp: string }

const path = (id: string, action = '') => `/admin/campaigns/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;

/** Notification campaigns. Loaded on demand and whenever the server announces a `campaigns` change (see lib/sync). */
export const useAdminCampaigns = create<{
  campaigns: Campaign[];
  loaded: boolean;
  load(): Promise<void>;
  save(id: string | null, input: CampaignInput): Promise<Campaign>;
  activate(id: string): Promise<Campaign>;
  pause(id: string): Promise<Campaign>;
  duplicate(id: string): Promise<Campaign>;
  remove(id: string): Promise<void>;
  detail(id: string): Promise<Campaign>;
  clear(): void;
}>((set, get) => {
  const put = (c: Campaign) => set({ campaigns: [c, ...get().campaigns.filter(x => x.id !== c.id)].sort((a, b) => b.updatedAt - a.updatedAt) });
  return {
    campaigns: [],
    loaded: false,
    async load() {
      if (!backendEnabled || !useLocal.getState().adminSession) return;
      set({ campaigns: await api<Campaign[]>('/admin/campaigns'), loaded: true });
    },
    async save(id, input) { const c = await api<Campaign>(id ? path(id) : '/admin/campaigns', { method: id ? 'PATCH' : 'POST', body: input }); put(c); return c; },
    async activate(id) { const c = await api<Campaign>(path(id, 'activate'), { method: 'POST', timeoutMs: 30000 }); put(c); return c; },
    async pause(id) { const c = await api<Campaign>(path(id, 'pause'), { method: 'POST' }); put(c); return c; },
    async duplicate(id) { const c = await api<Campaign>(path(id, 'duplicate'), { method: 'POST' }); put(c); return c; },
    async remove(id) { await api(path(id), { method: 'DELETE' }); set({ campaigns: get().campaigns.filter(c => c.id !== id) }); },
    detail: id => api<Campaign>(path(id)),
    clear: () => set({ campaigns: [], loaded: false }),
  };
});
