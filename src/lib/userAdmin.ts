import type { AppUser } from '@/data/types';
import { api, backendEnabled } from '@/lib/backend';
import { useStore } from '@/store/useStore';

export type CreditMode = 'add' | 'subtract' | 'set';
export type BulkOp =
  | { type: 'block' | 'unblock' | 'delete' }
  | { type: 'credits'; mode: CreditMode; amount: number };

export const MAX_CREDITS = 1_000_000;
/** Admin accounts can have their credits edited, but never be blocked or deleted from this screen. */
export const isProtected = (u: Pick<AppUser, 'role'>) => u.role === 'admin';

/** The credit balance one user ends up with for a given operation (same maths as the server). */
export const nextCredits = (current: number, mode: CreditMode, amount: number) =>
  Math.min(MAX_CREDITS, Math.max(0, mode === 'set' ? amount : mode === 'add' ? current + amount : current - amount));

/**
 * Applies ONE operation to many users. Server clients go through a single all-or-nothing request,
 * local/demo users are updated in the local store. Returns how many users were changed.
 */
export async function applyBulk(ids: string[], op: BulkOp): Promise<number> {
  const store = useStore.getState();
  const users = store.users.filter((u) => ids.includes(u.id));
  const targets = op.type === 'credits' ? users : users.filter((u) => !isProtected(u));
  if (!targets.length) return 0;

  // With the backend every user is a database client; local users only exist in offline demo mode.
  const remote = backendEnabled ? targets : [];
  const local = backendEnabled ? [] : targets;
  if (remote.length) {
        await api('/admin/clients/bulk', {
      method: 'POST',
      body: { ids: remote.map((u) => u.id), action: op.type, ...(op.type === 'credits' ? { mode: op.mode, amount: op.amount } : {}) },
    });
  }
  if (local.length) {
    if (op.type === 'delete') await store.removeMany('users', local.map((u) => u.id));
    else for (const u of local) {
      await store.update('users', u.id, op.type === 'credits' ? { credits: nextCredits(u.credits, op.mode, op.amount) } : { blocked: op.type === 'block' });
    }
  }
  await useStore.getState().reload('users');
  return targets.length;
}
