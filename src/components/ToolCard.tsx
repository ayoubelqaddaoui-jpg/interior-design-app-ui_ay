import React from 'react';
import { Pressable, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { Tool } from '@/data/types';
import { MediaView, PressableScale, Txt } from '@/components/ui';
import { useL, useT } from '@/i18n';

/** Home tool card: media (image or autoplay video) + title/subtitle + Try button. */
export function ToolCard({ tool, onPress, index = 0, height = 190 }: { tool: Tool; onPress: () => void; index?: number; height?: number }) {
  const L = useL();
  const { t } = useT();
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 70).duration(380)}>
      <PressableScale testID={`tool-${tool.id}`} onPress={onPress}>
        <MediaView media={tool.media} className="rounded-2xl" style={{ height }}>
          <LinearGradient colors={['rgba(0,0,0,0.62)', 'rgba(0,0,0,0.05)', 'rgba(0,0,0,0)']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.75 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
          <View className="absolute top-3 left-3 right-3 flex-row items-start justify-between">
            <View className="flex-1 pr-2">
              <Txt className="text-white text-[18px] font-extrabold" style={{ textShadowColor: 'rgba(0,0,0,.35)', textShadowRadius: 4 }}>{L(tool.title)}</Txt>
              <Txt className="text-white/90 text-[12.5px] mt-0.5" numberOfLines={2}>{L(tool.subtitle)}</Txt>
            </View>
            <Pressable onPress={onPress} className="bg-ink rounded-full px-4 h-8 items-center justify-center active:opacity-80">
              <Txt className="text-onink font-bold text-[13px]">{t('common.try')}</Txt>
            </Pressable>
          </View>
        </MediaView>
      </PressableScale>
    </Animated.View>
  );
}
