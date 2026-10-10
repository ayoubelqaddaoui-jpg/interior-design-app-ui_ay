import * as ImagePicker from 'expo-image-picker';
import * as Manipulator from 'expo-image-manipulator';
import { services } from '@/data/repositories';

export type PickResult = { uri: string } | { error: 'permission' | 'cancelled' };

/** Camera or Gallery ONLY. Result is downscaled so it is cheap to store/upload. */
export async function pickPhoto(source: 'camera' | 'gallery'): Promise<PickResult> {
  try {
    let res: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return { error: 'permission' };
      res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    } else {
      res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsMultipleSelection: false });
    }
    if (res.canceled || !res.assets?.[0]) return { error: 'cancelled' };
    let uri = res.assets[0].uri;
    try {
      const out = await Manipulator.manipulateAsync(uri, [{ resize: { width: 1024 } }], { compress: 0.6, format: Manipulator.SaveFormat.JPEG });
      uri = out.uri;
    } catch { /* keep original */ }
    return { uri: await services.upload.upload(uri, 'photos') };
  } catch {
    return { error: 'permission' };
  }
}
