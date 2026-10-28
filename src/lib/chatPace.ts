import type { AssistantConfig } from '@/data/types';

export const DEFAULT_MIN_MS = 900;
export const DEFAULT_MAX_MS = 3500;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Bounds the admin can tune; always sane (min ≤ max, within 0–15 s). */
export function paceBounds(config: Pick<AssistantConfig, 'replyDelayMode' | 'replyDelayMinMs' | 'replyDelayMaxMs'>) {
  const min = clamp(num(config.replyDelayMinMs, DEFAULT_MIN_MS), 0, 15000);
  const max = clamp(num(config.replyDelayMaxMs, DEFAULT_MAX_MS), min, 15000);
  return { min, max };
}

/**
 * How long a reply should have been "on its way" before it shows, counted from the moment the visitor sent the message.
 * Models a person: a short reading beat, then ~55 characters a second of typing, held inside the admin's bounds.
 * `off` never waits; the real network time already counts towards it.
 */
export function replyDelayMs(config: Pick<AssistantConfig, 'replyDelayMode' | 'replyDelayMinMs' | 'replyDelayMaxMs'>, reply: string): number {
  const mode = config.replyDelayMode ?? 'auto';
  if (mode === 'off') return 0;
  const { min, max } = paceBounds(config);
  const natural = 500 + reply.length * 18;
  if (mode === 'custom') return clamp(natural, min, max);
  return clamp(natural, DEFAULT_MIN_MS, DEFAULT_MAX_MS);
}

/** Characters revealed per 40 ms tick so a long answer never takes more than ~4 s to type out. */
export const typeStep = (length: number) => Math.max(2, Math.ceil(length / 100));
