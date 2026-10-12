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
