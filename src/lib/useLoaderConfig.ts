import { useMemo } from 'react';
import { useStore } from '@/store/useStore';
import { useTheme } from '@/theme/ThemeProvider';
import { loaderConfig, type LoaderConfig } from './boot';

/** The admin's loader (style, colour, custom image) with the live theme, for every spinner in the app. */
export function useLoaderConfig(): LoaderConfig {
  const settings = useStore((s) => s.doc.settings);
  const { colors } = useTheme();
  return useMemo(() => loaderConfig(settings, colors), [settings, colors]);
}
