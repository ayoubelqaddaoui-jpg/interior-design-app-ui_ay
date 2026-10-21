export function moveSelection<T extends { id: string }>(rows: T[], ids: string[], direction: -1 | 1): T[] {
  const result = [...rows];
  const selected = new Set(ids);
  const indices = direction === -1 ? result.map((_, i) => i) : result.map((_, i) => i).reverse();
  for (const i of indices) {
    const j = i + direction;
    if (selected.has(result[i].id) && j >= 0 && j < result.length && !selected.has(result[j].id)) {
      [result[i], result[j]] = [result[j], result[i]];
    }
  }
  return result;
}

/**
 * Drag-and-drop move: the dragged rows (one, or a whole selection dragged together) take the place of `targetId`.
 * Dragging downwards lands after the target, upwards before it, exactly like dropping on a list.
 */
export function moveTo<T extends { id: string }>(rows: T[], ids: string[], targetId: string): T[] {
  const picked = new Set(ids);
  const targetAt = rows.findIndex((row) => row.id === targetId);
  const firstAt = rows.findIndex((row) => picked.has(row.id));
  if (targetAt < 0 || firstAt < 0 || picked.has(targetId)) return rows;
  const moving = rows.filter((row) => picked.has(row.id));
  const rest = rows.filter((row) => !picked.has(row.id));
  rest.splice(rest.findIndex((row) => row.id === targetId) + (firstAt < targetAt ? 1 : 0), 0, ...moving);
  return rest;
}
