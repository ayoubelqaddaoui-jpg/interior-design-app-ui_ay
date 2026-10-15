import { useWizard } from '@/store/useWizard';
import { router, useBackCheckpoint, useLeaveGuard } from './useLeaveGuard';

/** Forward wizard transitions retain progress; any back/close/exit uses the shared dialog. */
export function useWizardGuard() {
  const dirty = useWizard(s => s.dirty);
  useLeaveGuard(dirty, async () => false, () => useWizard.getState().clear(), undefined, destination => {
    if (!useWizard.getState().dirty) return true;
    if (!destination) return false;
    return destination === '/lead' || destination === '/render' || destination === '/pro?generation=1' || destination.startsWith(`/tool/${useWizard.getState().toolId}?forward=1`);
  });
  useBackCheckpoint(dirty, () => router.back());
}
