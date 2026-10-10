import React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { sorted, useStore } from '@/store/useStore';
import { useL, useT } from '@/i18n';
import { GridSelector, Icon, Txt } from '@/components/ui';

function Circle({ uri, on }: { uri: string; on: boolean }) {
  const a = useAnimatedStyle(() => ({ transform: [{ scale: withSpring(on ? 1.06 : 1, { damping: 12 }) }] }));
  return (
    <Animated.View style={a} className={`rounded-full ${on ? 'border-[3px] border-primary' : 'border-[3px] border-transparent'}`}>
      <View className="rounded-full overflow-hidden bg-surface2" style={{ aspectRatio: 1 }}>
        <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={Platform.OS === 'web' ? 0 : 200} />
        {on ? <View className="absolute inset-0 bg-black/20 items-center justify-center"><View className="w-7 h-7 rounded-full bg-primary items-center justify-center"><Icon name="check" size={18} tone="onprimary" /></View></View> : null}
      </View>
    </Animated.View>
  );
}

export function StepStyle({ value, onChange }: { value?: string; onChange: (id: string) => void }) {
  const { t } = useT();
  const L = useL();
  const styles = sorted(useStore((s) => s.styles)).filter((x) => x.visible);
  return (
    <View>
      <Txt className="text-[16px] font-bold mb-3">{t('wizard.styleTitle')}</Txt>
      <GridSelector items={styles} cols={{ m: 3, t: 4, d: 6 }} gap={10} renderItem={(s) => (
        <Pressable testID={`style-${s.id}`} onPress={() => onChange(s.id)} className="items-center active:opacity-80">
          <View className="w-full"><Circle uri={s.image} on={value === s.id} /></View>
          <Txt className={`text-[11.5px] mt-1.5 text-center ${value === s.id ? 'font-extrabold' : 'text-muted'}`} numberOfLines={1}>{L(s.title)}</Txt>
        </Pressable>
      )} />
    </View>
  );
}
