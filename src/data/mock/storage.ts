import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'dwira:v1:';
export const storage = {
  async read<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await AsyncStorage.getItem(PREFIX + key);
      return raw ? (JSON.parse(raw) as T) : undefined;
    } catch {
      return undefined;
    }
  },
  async write(key: string, value: unknown) {
    try {
      await AsyncStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* quota / private mode: keep in-memory only */
    }
  },
  async clearAll() {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    await AsyncStorage.multiRemove(keys);
  },
};
