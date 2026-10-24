import React, { useEffect, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { Image } from 'expo-image';
import type { LoaderConfig } from '@/lib/boot';

const loop = (value: Animated.Value, duration: number, delay = 0, easing = Easing.linear) =>
  Animated.loop(Animated.sequence([Animated.delay(delay), Animated.timing(value, { toValue: 1, duration, easing, useNativeDriver: true }), Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true })]));
function useLoop(count: number, duration: number, stagger: number, easing = Easing.linear, delays?: number[]) {
  const [values] = useState(() => Array.from({ length: count }, () => new Animated.Value(0)));
  useEffect(() => {
    const animations = values.map((value, i) => loop(value, duration, delays ? delays[i] : i * stagger, easing));
    animations.forEach((a) => a.start());
    return () => animations.forEach((a) => a.stop());
  }, [values, duration, stagger, easing, delays]);
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
/** Moroccan collection (native twins of the SVG loaders in loaderShell.js; drawn with plain Views, no extra dependency). */
const turn = (v: Animated.Value, to = '360deg') => ({ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', to] }) });
function Zellige({ color }: { color: string }) {
  const [a] = useLoop(1, 4000, 0);
  const [beat] = useLoop(1, 1600, 0, Easing.inOut(Easing.quad));
  const square = { position: 'absolute' as const, width: 30, height: 30, borderRadius: 2, borderWidth: 3, borderColor: color };
  return <View style={{ width: 60, height: 60, alignItems: 'center', justifyContent: 'center' }}>
    <View style={{ position: 'absolute', width: 54, height: 54, borderRadius: 27, borderWidth: 2, borderColor: color + '26' }} />
    <Animated.View style={[square, { transform: [turn(a)] }]} />
    <Animated.View style={[square, { transform: [{ rotate: a.interpolate({ inputRange: [0, 1], outputRange: ['45deg', '-315deg'] }) }] }]} />
    <Animated.View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color, opacity: beat.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.6, 1, 0.6] }), transform: [{ scale: beat.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.8, 1.1, 0.8] }) }] }} />
  </View>;
}
function Arch({ color }: { color: string }) {
  const values = useLoop(3, 1800, 250, Easing.inOut(Easing.quad));
  const sizes = [[44, 52], [30, 41], [16, 27]] as const;
  return <View style={{ width: 60, height: 60, alignItems: 'center', justifyContent: 'flex-end' }}>
    {values.map((v, i) => <Animated.View key={i} style={{ position: 'absolute', bottom: 2, width: sizes[i][0], height: sizes[i][1], borderTopLeftRadius: sizes[i][0] * 0.5, borderTopRightRadius: sizes[i][0] * 0.5, borderWidth: 3.5, borderBottomWidth: 0, borderColor: color, opacity: v.interpolate({ inputRange: [0, 0.35, 0.6, 1], outputRange: [0.18, 1, 1, 0.18] }) }} />)}
  </View>;
}
function Lantern({ color }: { color: string }) {
  const [swing] = useLoop(1, 2400, 0, Easing.inOut(Easing.sin));
  const [flame] = useLoop(1, 900, 0, Easing.inOut(Easing.quad));
  return <Animated.View style={{ width: 48, height: 62, alignItems: 'center', transformOrigin: ['50%', 0, 0], transform: [{ rotate: swing.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: ['0deg', '9deg', '0deg', '-9deg', '0deg'] }) }] } as any}>
    <View style={{ width: 2.5, height: 8, backgroundColor: color, borderRadius: 2 }} />
    <View style={{ width: 0, height: 0, borderLeftWidth: 7, borderRightWidth: 7, borderBottomWidth: 8, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: color }} />
    <View style={{ width: 22, height: 40, borderWidth: 3, borderColor: color, borderTopWidth: 3, borderBottomLeftRadius: 11, borderBottomRightRadius: 11, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 6 }}>
      <Animated.View style={{ width: 8, height: 14, borderRadius: 7, backgroundColor: color, transform: [{ scaleY: flame.interpolate({ inputRange: [0, 0.3, 0.6, 1], outputRange: [1, 1.18, 0.9, 1] }) }, { scaleX: flame.interpolate({ inputRange: [0, 0.3, 0.6, 1], outputRange: [1, 0.85, 1.1, 1] }) }] }} />
    </View>
  </Animated.View>;
}
// A diagonal wave: each tile starts a little after its upper-left neighbour (same timing as the CSS version).
const MOSAIC_DELAYS = [0, 150, 300, 150, 300, 450, 300, 450, 600];
function Mosaic({ color }: { color: string }) {
  const values = useLoop(9, 1500, 0, Easing.inOut(Easing.quad), MOSAIC_DELAYS);
  return <View style={{ width: 60, height: 60 }}>
    {values.map((v, i) => <Animated.View key={i} style={{ position: 'absolute', left: 4 + (i % 3) * 18, top: 4 + Math.floor(i / 3) * 18, width: 11.3, height: 11.3, backgroundColor: color, opacity: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.3, 1, 0.3] }), transform: [{ rotate: '45deg' }, { scale: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.3, 1, 0.3] }) }] }} />)}
  </View>;
}
function Custom({ uri, anim }: { uri: string; anim: LoaderConfig['anim'] }) {
  const [v] = useLoop(1, 1200, 0, anim === 'pulse' ? Easing.inOut(Easing.quad) : Easing.linear);
  const transform = anim === 'spin' ? [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] : anim === 'pulse' ? [{ scale: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.85, 1, 0.85] }) }] : [];
  return <Animated.View style={{ transform }}><Image source={{ uri }} style={{ width: 96, height: 96 }} contentFit="contain" autoplay /></Animated.View>;
}

/** Native drawing of the same loader styles as the web shell (src/lib/loaderShell.js). */
export function BootLoader({ config, scale = 1 }: { config: Pick<LoaderConfig, 'style' | 'color' | 'uri' | 'anim'>; scale?: number }) {
  const color = /^#[0-9a-fA-F]{6}$/.test(config.color) ? config.color : '#111111';
  const body = config.style === 'custom' && config.uri ? <Custom uri={config.uri} anim={config.anim} />
    : config.style === 'zellige' ? <Zellige color={color} /> : config.style === 'arch' ? <Arch color={color} /> : config.style === 'lantern' ? <Lantern color={color} /> : config.style === 'mosaic' ? <Mosaic color={color} />
    : config.style === 'dots' ? <Dots color={color} /> : config.style === 'pulse' ? <Pulse color={color} /> : config.style === 'bars' ? <Bars color={color} /> : <Ring color={color} />;
  return <View style={{ width: 96, height: 96, alignItems: 'center', justifyContent: 'center', transform: scale === 1 ? undefined : [{ scale }] }}>{body}</View>;
}
