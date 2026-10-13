import React from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

/** Pressable with a subtle spring scale (micro-interaction). Visuals go in children. */
export function PressableScale({ children, style, scaleTo = 0.97, ...p }: PressableProps & { style?: StyleProp<ViewStyle>; scaleTo?: number; children?: React.ReactNode; className?: string }) {
  const s = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Pressable
      {...p}
      style={style}
      onPressIn={(e) => { s.set(withSpring(scaleTo, { damping: 18, stiffness: 320 })); p.onPressIn?.(e); }}
      onPressOut={(e) => { s.set(withSpring(1, { damping: 14, stiffness: 240 })); p.onPressOut?.(e); }}
    >
      <Animated.View style={[a, { flexGrow: 1 }]}>{children as any}</Animated.View>
    </Pressable>
  );
}
