import { Platform, Share } from 'react-native';

async function toLocalFile(url: string): Promise<string> {
  const { File, Directory, Paths } = await import('expo-file-system');
  const dir = new Directory(Paths.cache, 'dwira');
  if (!dir.exists) dir.create();
  const out = await File.downloadFileAsync(url, dir, { idempotent: true } as any);
  return typeof out === 'string' ? out : (out as any).uri;
}

/** Save an image to the device gallery (native) or trigger a download (web). Returns false on failure/denied. */
export async function saveImage(url: string): Promise<boolean> {
  try {
    if (Platform.OS === 'web') {
      const blob = await (await fetch(url)).blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `dwira-${Date.now()}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return true;
    }
    const ML = await import('expo-media-library');
    const perm = await ML.requestPermissionsAsync(true);
    if (!perm.granted) return false;
    const local = url.startsWith('file:') ? url : await toLocalFile(url);
    await ML.Asset.create(local);
    return true;
  } catch {
    return false;
  }
}

export async function shareImage(url: string, message: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      const nav: any = navigator;
      if (nav.share) { await nav.share({ title: 'Dwira', text: message, url }); return; }
      await nav.clipboard?.writeText(url);
      return;
    }
    const Sharing = await import('expo-sharing');
    if (await Sharing.isAvailableAsync()) {
      const local = url.startsWith('file:') ? url : await toLocalFile(url);
      await Sharing.shareAsync(local, { dialogTitle: message });
      return;
    }
    await Share.share({ message, url });
  } catch {
    /* user cancelled */
  }
}

export const cleanPhone = (v: string) => v.replace(/[^\d+]/g, '').replace(/^00/, '+');
export const validPhone = (v: string) => /^\+?\d{9,15}$/.test(cleanPhone(v));
export const waLink = (phone: string, text?: string) => `https://wa.me/${cleanPhone(phone).replace('+', '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
