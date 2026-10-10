export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
