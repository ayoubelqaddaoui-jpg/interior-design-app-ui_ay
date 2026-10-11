import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { sorted, useStore } from '@/store/useStore';
import { useL, useT } from '@/i18n';
import { CreditsBadge, Icon, MediaView, PressableScale, Screen, Txt } from '@/components/ui';
import { useBp } from '@/hooks/useBp';

export default function Explore() {
  const { t } = useT();
  const L = useL();
  const { desktop } = useBp();
  const sections = useStore((s) => s.sections);
  const categories = useStore((s) => s.categories);
  const items = useStore((s) => s.inspirations);

  const header = !desktop ? (
    <View className="flex-row items-center justify-between h-14">
      <Txt className="text-[26px] font-black">{t('explore.title')}</Txt>
      <CreditsBadge />
    </View>
  ) : <Txt className="text-[28px] font-black pt-6 pb-2">{t('explore.title')}</Txt>;

  return (
    <Screen header={header} bottomInset={16}>
      {sorted(sections).filter((s) => s.visible).map((sec, si) => {
        const cats = sorted(categories).filter((c) => c.visible && c.sectionId === sec.id);
        return (
          <Animated.View key={sec.id} entering={FadeInDown.delay(si * 100).duration(350)} className="mt-4 mb-2">
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-row items-center gap-2 flex-1">
                <Icon name={sec.icon} size={22} />
                <Txt className="text-[18px] font-extrabold flex-1" numberOfLines={1}>{L(sec.title)}</Txt>
              </View>
              <Pressable testID={`seeall-${sec.id}`} onPress={() => router.push({ pathname: '/explore/section/[id]', params: { id: sec.id } })} className="flex-row items-center gap-0.5 active:opacity-60">
                <Txt className="text-muted text-[13px]">{t('common.seeAll')}</Txt>
                <Icon name="chevron-right" size={16} tone="muted" flip />
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
              {cats.map((c) => {
                const n = items.filter((i) => i.categoryId === c.id && i.visible).length;
                return (
                  <PressableScale key={c.id} testID={`cat-${c.id}`} onPress={() => router.push({ pathname: '/explore/category/[id]', params: { id: c.id } })}>
                    <MediaView uri={c.cover} className="rounded-2xl" style={{ width: desktop ? 220 : 148, height: desktop ? 280 : 196 }}>
                      <View className="absolute inset-0 bg-black/40 items-center justify-center px-2">
                        <Txt className="text-white text-[28px] leading-[34px] font-black">+{n}</Txt>
                        <Txt className="text-white text-[13px] leading-[17px] font-bold mt-1 text-center" numberOfLines={2}>{L(c.title)}</Txt>
                      </View>
                    </MediaView>
                  </PressableScale>
                );
              })}
            </ScrollView>
          </Animated.View>
        );
      })}
    </Screen>
  );
}
