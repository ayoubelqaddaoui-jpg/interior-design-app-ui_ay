import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { BootLoader } from '@/components/BootLoader';
import { useLoaderConfig } from '@/lib/useLoaderConfig';

/**
 * In-app loading indicator using the admin's loader (Admin > Interface > Loading screen): same style, colour and custom
 * image as the startup screen, everywhere in the app. With the loader switched off it falls back to the platform spinner.
 * `size` is the box size in px (the built-in loaders are drawn in a 96 px box and scaled).
 */
export function Spinner({ size = 40, color, testID }: { size?: number; color?: string; testID?: string }) {
  const cfg = useLoaderConfig();
  if (!cfg.enabled) return <ActivityIndicator testID={testID} size={size >= 36 ? 'large' : 'small'} color={color ?? cfg.color} />;
  const scale = size / 96;
  return (
    <View testID={testID} accessibilityRole="progressbar" style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
      <View style={{ width: 96, height: 96, alignItems: 'center', justifyContent: 'center', transform: [{ scale }] }}>
        <BootLoader config={{ ...cfg, color: color ?? cfg.color }} />
      </View>
    </View>
  );
}
