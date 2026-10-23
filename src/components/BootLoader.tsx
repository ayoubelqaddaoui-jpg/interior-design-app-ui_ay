import React, { useEffect, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { Image } from 'expo-image';
import type { LoaderConfig } from '@/lib/boot';

const loop = (value: Animated.Value, duration: number, delay = 0, easing = Easing.linear) =>
  Animated.loop(Animated.sequence([Animated.delay(delay), Animated.timing(value, { toValue: 1, duration, easing, useNativeDriver: true }), Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true })]));
function useLoop(count: number, duration: number, stagger: number, easing = Easing.linear) {
  const [values] = useState(() => Array.from({ length: count }, () => new Animated.Value(0)));
  useEffect(() => {
    const animations = values.map((value, i) => loop(value, duration, i * stagger, easing));
    animations.forEach((a) => a.start());
    return () => animations.forEach((a) => a.stop());
  }, [values, duration, stagger, easing]);
  return values;
}

function Ring({ color }: { color: string }) {
  const [v] = useLoop(1, 1000, 0);
  return <Animated.View style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 5, borderColor: color + '2E', borderTopColor: color, transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }} />;
}
function Dots({ color }: { color: string }) {
  const values = useLoop(3, 1000, 150, Easing.inOut(Easing.quad));
  return <View style={{ flexDirection: 'row', gap: 8 }}>{values.map((v, i) => <Animated.View key={i} style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: color, opacity: v.interpolate({ inputRange: [0, 0.4, 0.8, 1], outputRange: [0.45, 1, 0.45, 0.45] }), transform: [{ scale: v.interpolate({ inputRange: [0, 0.4, 0.8, 1], outputRange: [0.55, 1, 0.55, 0.55] }) }] }} />)}</View>;
}
function Pulse({ color }: { color: string }) {
  const values = useLoop(2, 1400, 700, Easing.out(Easing.quad));
  return <View style={{ width: 56, height: 56 }}>{values.map((v, i) => <Animated.View key={i} style={{ position: 'absolute', width: 56, height: 56, borderRadius: 28, backgroundColor: color, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.1, 1] }) }] }} />)}</View>;
}
function Bars({ color }: { color: string }) {
  const values = useLoop(4, 1000, 120, Easing.inOut(Easing.quad));
  return <View style={{ flexDirection: 'row', gap: 5, height: 40, alignItems: 'center' }}>{values.map((v, i) => <Animated.View key={i} style={{ width: 7, height: 40, borderRadius: 3, backgroundColor: color, transform: [{ scaleY: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.35, 1, 0.35] }) }] }} />)}</View>;
}
function Custom({ uri, anim }: { uri: string; anim: LoaderConfig['anim'] }) {
  const [v] = useLoop(1, 1200, 0, anim === 'pulse' ? Easing.inOut(Easing.quad) : Easing.linear);
  const transform = anim === 'spin' ? [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] : anim === 'pulse' ? [{ scale: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.85, 1, 0.85] }) }] : [];
  return <Animated.View style={{ transform }}><Image source={{ uri }} style={{ width: 96, height: 96 }} contentFit="contain" autoplay /></Animated.View>;
}

/** Native drawing of the same five loader styles as the web shell (src/lib/loaderShell.js). */
export function BootLoader({ config, scale = 1 }: { config: Pick<LoaderConfig, 'style' | 'color' | 'uri' | 'anim'>; scale?: number }) {
  const color = /^#[0-9a-fA-F]{6}$/.test(config.color) ? config.color : '#111111';
  const body = config.style === 'custom' && config.uri ? <Custom uri={config.uri} anim={config.anim} />
    : config.style === 'dots' ? <Dots color={color} /> : config.style === 'pulse' ? <Pulse color={color} /> : config.style === 'bars' ? <Bars color={color} /> : <Ring color={color} />;
  return <View style={{ width: 96, height: 96, alignItems: 'center', justifyContent: 'center', transform: scale === 1 ? undefined : [{ scale }] }}>{body}</View>;
}
