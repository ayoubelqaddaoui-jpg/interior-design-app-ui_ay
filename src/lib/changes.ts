export type Change = { path: string; before: unknown; after: unknown; label?: string; secret?: boolean };
/** Leaf-level comparison: preserve language keys, added/removed values and array order. */
export function changes(before: unknown, after: unknown, path = ''): Change[] {
  if (Object.is(before, after)) return [];
  if (before && after && typeof before === 'object' && typeof after === 'object') {
    const a = before as Record<string, unknown>, b = after as Record<string, unknown>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(key => changes(a[key], b[key], path ? `${path}.${key}` : key));
  }
  return [{ path, before, after }];
}
