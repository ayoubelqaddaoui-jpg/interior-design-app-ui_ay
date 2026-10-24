import { Platform } from 'react-native';
import { api, backendEnabled } from '@/lib/backend';

/**
 * Admin media uploads. Every file ends up in the server's media storage (Cloudflare R2, or the database fallback when R2 is
 * not configured) and the field stores the returned `/api/media/<hash>.<ext>` URL, never base64.
 *  - small images: POST /admin/media with the data URL (the server checks the real type, then stores it)
 *  - videos / large files: presigned PUT straight to R2 (5 minutes), then /admin/media/complete verifies the object
 *  - external image URLs: POST /admin/media/import, the server downloads the image once
 */
const INLINE_MAX = 2.5 * 1024 * 1024; // larger files take the direct (presigned) path; the JSON body limit is 4 MB
const MEDIA_URL = /^(?:https?:\/\/[^/]+)?\/api\/media\/[a-f0-9]{32}\.[a-z0-9]+$/;

export const isStoredMedia = (value: string) => MEDIA_URL.test(value);
export const mediaUploadsEnabled = backendEnabled;

type Presigned = { id: string; uploadUrl: string; method: 'PUT'; headers: Record<string, string>; url: string; maxBytes: number };

/** A data URL (from the image picker) -> /api/media URL. */
export async function uploadDataUrl(dataUrl: string): Promise<string> {
  const out = await api<{ url: string }>('/admin/media', { method: 'POST', body: { data: dataUrl } });
  return out.url;
}

/** Copies an external https image into storage (admins pasting Unsplash or CDN links). */
export async function importMediaUrl(url: string): Promise<string> {
  const out = await api<{ url: string }>('/admin/media/import', { method: 'POST', body: { url } });
  return out.url;
}

async function directUpload(size: number, contentType: string, put: (target: Presigned) => Promise<number>): Promise<string> {
  const target = await api<Presigned>('/admin/media/presign', { method: 'POST', body: { contentType, size } });
  const status = await put(target);
  if (status < 200 || status >= 300) throw new Error('UPLOAD_FAILED');
  const done = await api<{ url: string }>('/admin/media/complete', { method: 'POST', body: { id: target.id } });
  return done.url;
}

/** Web: a File/Blob from an <input type=file>. Small images go inline; videos and large files go straight to R2. */
export async function uploadBlob(file: Blob): Promise<string> {
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/') && type !== 'image/svg+xml' && file.size <= INLINE_MAX) return uploadDataUrl(await blobToDataUrl(file));
  if (type === 'image/svg+xml') {
    if (file.size > INLINE_MAX) throw new Error('MEDIA_TOO_LARGE');
    return uploadDataUrl(await blobToDataUrl(file));
  }
  return directUpload(file.size, type, async (target) => (await fetch(target.uploadUrl, { method: 'PUT', headers: target.headers, body: file })).status);
}

/** Native: a local file:// URI (streamed from disk by the OS, so large videos never sit in JS memory). */
export async function uploadLocalFile(uri: string, contentType: string, size: number): Promise<string> {
  const FileSystem = await import('expo-file-system/legacy');
  return directUpload(size, contentType, async (target) => (await FileSystem.uploadAsync(target.uploadUrl, uri, { httpMethod: 'PUT', headers: target.headers, uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT })).status);
}

function blobToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

/** Lets the admin pick a video file and uploads it directly to R2. Resolves '' when cancelled. */
export async function pickAndUploadVideo(): Promise<string> {
  if (Platform.OS === 'web') {
    if (typeof document === 'undefined') return '';
    const file = await new Promise<File | null>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'video/mp4,video/webm,video/quicktime';
      input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;width:1px;height:1px';
      input.addEventListener('change', () => { resolve(input.files?.[0] ?? null); input.remove(); });
      input.addEventListener('cancel', () => { resolve(null); input.remove(); });
      document.body.appendChild(input);
      input.click();
    });
    return file ? uploadBlob(file) : '';
  }
  const ImagePicker = await import('expo-image-picker');
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsMultipleSelection: false, quality: 1 });
  const asset = res.canceled ? undefined : res.assets?.[0];
  if (!asset) return '';
  let size = asset.fileSize;
  if (!size) {
    const { File } = await import('expo-file-system');
    size = new File(asset.uri).size ?? 0;
  }
  const lower = asset.uri.toLowerCase();
  const type = asset.mimeType || (lower.endsWith('.mov') ? 'video/quicktime' : lower.endsWith('.webm') ? 'video/webm' : 'video/mp4');
  return uploadLocalFile(asset.uri, type, size);
}
