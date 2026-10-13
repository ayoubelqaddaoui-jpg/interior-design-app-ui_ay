import { useEffect, useId, useCallback } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { create } from 'zustand';

const dock = create<{ heights: Record<string, number> }>(() => ({ heights: {} }));
/** Stack bottom obstructions (draft toolbar + bulk panel) without covering their actions. */
export const useSearchInset = () => dock(s => Object.values(s.heights).reduce((sum, height) => sum + height, 0));
export function useSearchObstacle(active: boolean, margin = 0) {
  const id = useId();
  useEffect(() => {
    return () => dock.setState(s => ({ heights: Object.fromEntries(Object.entries(s.heights).filter(([key]) => key !== id)) }));
  }, [id, active]);
  return useCallback((event: LayoutChangeEvent) => {
    if (!active) return;
    const height = event.nativeEvent.layout.height + margin;
    if (dock.getState().heights[id] !== height) dock.setState(s => ({ heights: { ...s.heights, [id]: height } }));
  }, [active, id, margin]);
}
