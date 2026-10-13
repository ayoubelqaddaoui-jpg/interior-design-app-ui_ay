import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import type { GalleryLayout } from '@/data/types';

const layouts: { id: GalleryLayout; key: string }[] = [
  { id: 'grid', key: 'grid' }, { id: 'masonry', key: 'masonry' },
  { id: 'editorial', key: 'editorial' }, { id: 'carousel', key: 'slideshow' },
];
/** Deliberately schematic: no photographs, network assets, or media components. */
function LayoutPreview({ layout }: { layout: GalleryLayout }) {
  const { dark } = useTheme();
  const gray = dark ? '#525862' : '#CDD2D9';
  const block = (height: number, key?: number) => <View key={key} style={{ height, borderRadius: 4, backgroundColor: gray }} />;
  const line = (width: '100%' | '75%' | '50%', key: number) => <View key={key} style={{ width, height: 4, borderRadius: 2, backgroundColor: gray }} />;
  if (layout === 'grid') return <View className="gap-1.5">{[0, 1].map((row) => <View key={row} className="flex-row gap-1.5">{[0, 1, 2].map((col) => <View key={col} className="flex-1">{block(53)}</View>)}</View>)}</View>;
  if (layout === 'masonry') return <View className="flex-row gap-1.5">{[[67, 39], [43, 63], [57, 49]].map((heights, col) => <View key={col} className="flex-1 gap-1.5">{heights.map((height, row) => block(height, row))}</View>)}</View>;
  if (layout === 'editorial') return <View className="gap-1.5">
    <View className="flex-row gap-2"><View style={{ flex: 2 }}>{block(67)}</View><View className="flex-1 gap-2 justify-center">{line('100%', 0)}{line('75%', 1)}{line('100%', 2)}{line('50%', 3)}</View></View>
    <View className="flex-row gap-1.5"><View className="flex-1">{block(37)}</View><View className="flex-1">{block(37)}</View><View className="flex-1 gap-2 justify-center">{line('100%', 0)}{line('75%', 1)}</View></View>
  </View>;
  return <View className="gap-1.5">
    <View>{block(78)}<View className="absolute inset-0 flex-row items-center justify-between px-1"><View className="bg-surface rounded-full p-1"><Icon name="chevron-left" size={15} flip /></View><View className="bg-surface rounded-full p-1"><Icon name="chevron-right" size={15} flip /></View></View><View className="absolute bottom-1.5 self-center flex-row gap-1">{[0, 1, 2].map((i) => <View key={i} className={i === 0 ? 'bg-primary' : 'bg-surface'} style={{ width: 5, height: 5, borderRadius: 3 }} />)}</View></View>
    <View className="flex-row gap-1.5">{[0, 1, 2, 3, 4].map((i) => <View key={i} className="flex-1">{block(27)}</View>)}</View>
  </View>;
}
export function ExhibitionLayouts({ value, onChange }: { value: GalleryLayout; onChange: (layout: GalleryLayout) => void }) {
  const { t } = useT();
  const [width, setWidth] = useState(0);
  return <View testID="exhibition-layouts" onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', margin: -4 }}>
    {layouts.map(({ id, key }) => <View key={id} style={{ width: width >= 340 ? '50%' : '100%', padding: 4 }}>
      <Pressable testID={`layout-${id}`} accessibilityRole="radio" accessibilityLabel={t(`improve.${key}Title`)} aria-checked={value === id} accessibilityState={{ selected: value === id }} onPress={() => onChange(id)} className={`rounded-xl border-2 p-2 ${value === id ? 'border-primary bg-soft' : 'border-line bg-surface'}`}>
        <View testID={`layout-preview-${id}`} className="rounded-lg bg-surface2 overflow-hidden p-2 mb-2" style={{ height: 132 }}><LayoutPreview layout={id} /></View>
        <View className="flex-row items-start gap-1"><Txt className="flex-1 font-bold text-[13px] leading-[19px]" style={{ minHeight: 38 }}>{t(`improve.${key}Title`)}</Txt><Icon name={value === id ? 'check-circle' : 'radiobox-blank'} size={17} tone={value === id ? 'primary' : 'muted'} /></View>
        <Txt className="text-muted text-[11px]" numberOfLines={2}>{t(`improve.${key}Desc`)}</Txt>
      </Pressable>
    </View>)}
  </View>;
}
