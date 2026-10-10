import React, { useEffect } from 'react';
import { type DimensionValue } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import { useTheme } from '@/theme/ThemeProvider';

export function Skeleton({ w = '100%', h = 16, r = 12, style, fill }: { w?: DimensionValue; h?: DimensionValue; r?: number; style?: any; fill?: boolean }) {
  const { colors } = useTheme();
  const o = useSharedValue(0.45);
  useEffect(() => { o.value = withRepeat(withTiming(1, { duration: 800, easing: Easing.inOut(Easing.quad) }), -1, true); }, [o]);
  const a = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ backgroundColor: colors.surface2, borderRadius: r }, fill ? { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } : { width: w, height: h }, a, style]} />;
}
