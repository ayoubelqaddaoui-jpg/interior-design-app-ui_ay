import { Platform } from 'react-native';
import { storage } from '@/data/mock/storage';

// This is a public URL, never an admin credential or VAPID private key.
const BASE = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '');
export const backendEnabled = !!BASE;
export class BackendError extends Error { constructor(public status: number, public code = '') { super(code || `Backend HTTP ${status}`); } }
let deviceToken: string | null = null;
export async function clientToken() {
  if (deviceToken) return deviceToken;
  const saved = await storage.read<string>('demand-client-token');
  if (saved) return deviceToken = saved;
  // Expo crypto uses the native secure RNG; browsers use crypto.getRandomValues.
  const random = Platform.OS === 'web' ? crypto.getRandomValues(new Uint8Array(32)) : await (await import('expo-crypto')).getRandomBytesAsync(32);
  deviceToken = Array.from(random, byte => byte.toString(16).padStart(2, '0')).join('');
  await storage.write('demand-client-token', deviceToken);
  return deviceToken;
}
export async function api<T>(path: string, options: { method?: string; body?: unknown; client?: boolean; raw?: Blob; headers?: Record<string, string> } = {}): Promise<T> {
  if (!backendEnabled) throw new Error('Backend is not configured');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...options.headers };
  if (options.client) headers['X-Demand-Token'] = await clientToken();
  if (Platform.OS !== 'web') {
    const { getItemAsync } = await import('expo-secure-store');
    const token = await getItemAsync('dwira-backend-session');
    if (token) headers.Authorization = `Bearer ${token}`;
    const userToken = await getItemAsync('dwira-user-session');
    if (userToken) headers['X-User-Token'] = userToken;
    headers['X-Dwira-Native'] = '1';
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const transport = Platform.OS === 'web' ? fetch : (await import('expo/fetch')).fetch;
    const response = await transport(`${BASE}${path}`, { method: options.method || 'GET', headers, credentials: 'include', body: options.raw ?? (options.body == null ? undefined : JSON.stringify(options.body)), signal: controller.signal });
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new BackendError(response.status, body.error); }
    return await response.json();
  } finally { clearTimeout(timeout); }
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

/** Upload once for streaming server-side hashing; no spam-monitor image copies are saved. */
export async function uploadSignal(uri: string) {
  const blob = Platform.OS !== 'web' && /^(file|content):/.test(uri)
    ? new (await import('expo-file-system')).File(uri)
    : await (await fetch(uri)).blob();
  return api<{ uploadId: string }>('/user/image', { method: 'POST', raw: blob, headers: { 'Content-Type': blob.type || 'image/jpeg', 'X-Device-ID': await clientToken() } });
}
