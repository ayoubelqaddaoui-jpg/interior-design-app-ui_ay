import * as ImagePicker from 'expo-image-picker';
import * as Manipulator from 'expo-image-manipulator';
import { services } from '@/data/repositories';
import { backendEnabled } from '@/lib/backend';
import type { PickOptions, PickResult } from './photoTypes';

export type { PickOptions, PickResult } from './photoTypes';

/**
 * The camera permission is requested ONCE, the first time it is needed. The OS stores the answer, so afterwards we only
 * read the current status and never prompt again. The gallery needs no permission (system photo picker): it is never gated.
 */
async function cameraAllowed(): Promise<boolean> {
  const current = await ImagePicker.getCameraPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false; // refused for good: only the system settings can change it
  return (await ImagePicker.requestCameraPermissionsAsync()).granted;
}

/** Camera or Gallery ONLY. Result is downscaled so it is cheap to store/upload. */
export async function pickPhoto(source: 'camera' | 'gallery', options: PickOptions = {}): Promise<PickResult> {
  try {
    let res: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      if (!await cameraAllowed()) return { error: 'permission' };
      res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    } else {
      res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: options.preserveTransparency ? 1 : 0.8, allowsMultipleSelection: false });
    }
    if (res.canceled || !res.assets?.[0]) return { error: 'cancelled' };
    let uri = res.assets[0].uri;
    try {
      const out = await Manipulator.manipulateAsync(uri, res.assets[0].width > 1024 ? [{ resize: { width: 1024 } }] : [], { compress: 0.6, format: options.preserveTransparency ? Manipulator.SaveFormat.PNG : Manipulator.SaveFormat.JPEG });
      uri = out.uri;
    } catch { /* keep original */ }
    // With the backend, send the (downscaled) bytes: the server stores them in media storage (R2) and keeps only the
    // /api/media URL. A device-local file:// path would mean nothing to the server or to other devices.
    if (backendEnabled) {
      const { File } = await import('expo-file-system');
      return { uri: `data:image/${options.preserveTransparency ? 'png' : 'jpeg'};base64,${await new File(uri).base64()}` };
    }
    return { uri: await services.upload.upload(uri, 'photos') };
  } catch {
    return { error: 'failed' };
  }
}
