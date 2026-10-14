import { Platform } from 'react-native';
import { storage } from '@/data/mock/storage';

// This is a public URL, never an admin credential or VAPID private key.
const BASE = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '');
export const backendEnabled = !!BASE;
export class BackendError extends Error { constructor(public status: number) { super(`Backend HTTP ${status}`); } }
let deviceToken: string | null = null;
export async function clientToken() {
  if (deviceToken) return deviceToken;
  const saved = await storage.read<string>('demand-client-token');
  if (saved) return deviceToken = saved;
  // Expo crypto uses the native secure RNG; browsers use crypto.getRandomValues.
  const random = Platform.OS === 'web' ? crypto.getRandomValues(new Uint8Array(32)) : (await import('expo-crypto')).getRandomBytes(32);
  deviceToken = Array.from(random, byte => byte.toString(16).padStart(2, '0')).join('');
  await storage.write('demand-client-token', deviceToken);
  return deviceToken;
}
export async function api<T>(path: string, options: { method?: string; body?: unknown; client?: boolean } = {}): Promise<T> {
  if (!backendEnabled) throw new Error('Backend is not configured');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.client) headers['X-Demand-Token'] = await clientToken();
  if (Platform.OS !== 'web') {
    const { getItemAsync } = await import('expo-secure-store');
    const token = await getItemAsync('dwira-backend-session');
    if (token) headers.Authorization = `Bearer ${token}`;
    headers['X-Dwira-Native'] = '1';
  }
  const response = await fetch(`${BASE}${path}`, { method: options.method || 'GET', headers, credentials: 'include', body: options.body == null ? undefined : JSON.stringify(options.body), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new BackendError(response.status);
  return response.json();
}
export async function backendLogin(email: string, password: string) {
  try {
    const result = await api<{ ok: true; user: { id: string; name: string }; token?: string }>('/admin/login', { method: 'POST', body: { email, password } });
    if (Platform.OS !== 'web' && result.token) {
      const { setItemAsync } = await import('expo-secure-store');
      await setItemAsync('dwira-backend-session', result.token);
    }
    return { ok: true as const, user: result.user };
  } catch { return { ok: false as const }; }
}
export async function backendLogout() {
  if (!backendEnabled) return;
  try { await api('/admin/logout', { method: 'POST', body: {} }); }
  finally { if (Platform.OS !== 'web') await (await import('expo-secure-store')).deleteItemAsync('dwira-backend-session'); }
}
