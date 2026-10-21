import React, { useEffect } from 'react';
import { Platform, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming, interpolate } from 'react-native-reanimated';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { NO_SELECT } from '@/lib/noSelect';

// Images never take pointer events: the slider (not the <img>) receives every press and drag.
const IMG = [StyleSheet.absoluteFill, { pointerEvents: 'none' }, NO_SELECT] as any;

/**
 * Interactive before/after slider.
 * - Reveal animation on first open: starts fully "before", wipes to the middle, with a small settle bounce.
 * - `hold` (Before button pressed) cross-fades to the original image.
 * Layout is forced LTR so the geometry is identical in RTL languages.
 */
export function BeforeAfter({ before, after, hold, aspect = 1.1 }: { before: string; after: string; hold: boolean; aspect?: number }) {
  const { t } = useT();
  const W = useSharedValue(0);
  const pos = useSharedValue(1);
  const hint = useSharedValue(1);
  const holdV = useSharedValue(0);

  useEffect(() => { holdV.set(withTiming(hold ? 1 : 0, { duration: 160 })); }, [hold, holdV]);

  useEffect(() => {
    pos.set(1);
    pos.set(withDelay(350, withSequence(withTiming(0.46, { duration: 1300, easing: Easing.bezier(0.22, 1, 0.36, 1) }), withTiming(0.5, { duration: 260 }))));
    hint.set(1);
    hint.set(withDelay(3200, withTiming(0, { duration: 500 })));
  }, [pos, hint]);

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => { if (W.value) pos.set(Math.min(1, Math.max(0, e.x / W.value))); hint.set(withTiming(0, { duration: 200 })); })
    .onUpdate((e) => { if (W.value) pos.set(Math.min(1, Math.max(0, e.x / W.value))); });

  const clip = useAnimatedStyle(() => ({ width: W.value * pos.value }));
  const line = useAnimatedStyle(() => ({ transform: [{ translateX: W.value * pos.value - 1 }] }));
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: W.value * pos.value - 22 }, { scale: interpolate(holdV.value, [0, 1], [1, 0.6]) }], opacity: 1 - holdV.value }));
  const holdStyle = useAnimatedStyle(() => ({ opacity: holdV.value }));
  const hintStyle = useAnimatedStyle(() => ({ opacity: hint.value }));
  const lblBefore = useAnimatedStyle(() => ({ opacity: pos.value > 0.12 ? 1 : 0 }));
  const lblAfter = useAnimatedStyle(() => ({ opacity: pos.value < 0.88 ? 1 : 0 }));

  return (
    <GestureDetector gesture={pan}>
      <View testID="before-after" style={[{ aspectRatio: aspect, width: '100%', direction: 'ltr', cursor: 'ew-resize', touchAction: 'none' } as any, NO_SELECT]} className="rounded-3xl overflow-hidden bg-surface2"
        // The browser's native image drag / context menu / selection must never compete with the slider.
        {...(Platform.OS === 'web' ? { onDragStart: (e: Event) => e.preventDefault(), onContextMenu: (e: Event) => e.preventDefault() } : {})} onLayout={(e) => { W.set(e.nativeEvent.layout.width); }}>
        <Image source={{ uri: after }} style={IMG} contentFit="cover" draggable={false} />
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, overflow: 'hidden' }, clip]}>
          <BeforeImg uri={before} W={W} />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, backgroundColor: '#fff' }, line]} />
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: '50%', marginTop: -22, width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, elevation: 5, flexDirection: 'row' }, knob]}>
          <Icon name="chevron-left" size={18} color="#111" /><Icon name="chevron-right" size={18} color="#111" />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, holdStyle]}>
          <Image source={{ uri: before }} style={StyleSheet.absoluteFill} contentFit="cover" />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 12, top: 12 }, lblBefore]}><View className="bg-black/55 rounded-full px-3 py-1"><Txt className="text-white text-[12px] font-bold">{t('result.before')}</Txt></View></Animated.View>
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', right: 12, top: 12 }, lblAfter]}><View className="bg-black/55 rounded-full px-3 py-1"><Txt className="text-white text-[12px] font-bold">{t('result.after')}</Txt></View></Animated.View>
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, bottom: 12, alignItems: 'center' }, hintStyle]}><View className="bg-black/55 rounded-full px-3 py-1"><Txt className="text-white text-[12px]">{t('result.slideHint')}</Txt></View></Animated.View>
      </View>
    </GestureDetector>
  );
}

function BeforeImg({ uri, W }: { uri: string; W: { value: number } }) {
  const s = useAnimatedStyle(() => ({ width: W.value }));
  return <Animated.View style={[{ position: 'absolute', left: 0, top: 0, bottom: 0 }, s]}><Image source={{ uri }} style={IMG} contentFit="cover" draggable={false} /></Animated.View>;
}
void runOnJS;
