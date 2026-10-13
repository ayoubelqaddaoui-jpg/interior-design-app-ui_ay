import React from 'react';
import { Platform } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import createIconSet from '@expo/vector-icons/createIconSet';
const WebIcons = createIconSet(MaterialCommunityIcons.glyphMap, 'DwiraIcons', require('../../../assets/fonts/web/MaterialCommunityIcons.woff2'));
const Icons = Platform.OS === 'web' ? WebIcons : MaterialCommunityIcons;
export const loadIcons = () => Icons.loadFont();
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n';
import type { TokenKey } from '@/theme/tokens';

export function Icon({ name, size = 22, tone = 'fg', color, flip }: { name: string; size?: number; tone?: TokenKey; color?: string; flip?: boolean }) {
  const { colors } = useTheme();
  const { rtl } = useT();
  return (
    <Icons
      name={name as any}
      size={size}
      color={color ?? colors[tone]}
      style={flip && rtl ? { transform: [{ scaleX: -1 }] } : undefined}
    />
  );
}
export const ICON_CHOICES = [
  'sofa-outline', 'bed-king-outline', 'stove', 'shower', 'silverware-fork-knife', 'stairs', 'balcony', 'baby-carriage', 'garage', 'door-open',
  'washing-machine', 'desk', 'laptop', 'book-open-variant', 'home-roof', 'home-variant-outline', 'flower-outline', 'pool', 'office-building-outline',
  'lamp', 'palette-outline', 'floor-plan', 'home-city-outline', 'pine-tree', 'wardrobe-outline', 'toilet', 'fridge-outline', 'chair-rolling',
];
