import React from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useBp } from '@/hooks/useBp';

/** Generic responsive grid with staggered entrance. Used for rooms, styles, palettes... */
export function GridSelector<T extends { id: string }>({ items, cols, renderItem, gap = 12 }: {
  items: T[]; cols?: { m: number; t: number; d: number }; renderItem: (item: T, index: number) => React.ReactNode; gap?: number;
}) {
  const { pick } = useBp();
  const n = cols ? pick(cols.m, cols.t, cols.d) : pick(2, 3, 4);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -gap / 2 }}>
      {items.map((it, i) => (
        <Animated.View key={it.id} entering={FadeInDown.delay(Math.min(i, 12) * 30).duration(280)} style={{ width: `${100 / n}%`, padding: gap / 2 }}>
          {renderItem(it, i)}
        </Animated.View>
      ))}
    </View>
  );
}
