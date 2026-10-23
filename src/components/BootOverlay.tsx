import React from 'react';
import { View } from 'react-native';
import { useBootOverlay } from '@/lib/boot';
import { BootLoader } from './BootLoader';

/**
 * Startup loader drawn by React: on native (Android / iOS app), and on web builds without the HTML shell loader (dev
 * server). Production web shows the identical loader from index.html instead (painted before any JavaScript).
 */
export function BootOverlay() {
  const config = useBootOverlay();
  if (!config) return null;
  return (
    <View pointerEvents="auto" accessibilityRole="progressbar" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: config.bg, zIndex: 1000 }}>
      <BootLoader config={config} />
    </View>
  );
}
