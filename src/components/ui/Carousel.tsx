import React, { useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Icon } from './Icon';
import { useBp } from '@/hooks/useBp';
import { useT } from '@/i18n';

/** Touch swipe on mobile; visible scrollbar + precise mouse/keyboard buttons on desktop. */
export function Carousel({ children, gap = 12 }: { children: React.ReactNode; gap?: number }) {
  const ref = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  const [content, setContent] = useState(0);
  const [offset, setOffset] = useState(0);
  const { desktop } = useBp();
  const { t } = useT();
  const scroll = (direction: number) => ref.current?.scrollTo({ x: Math.min(Math.max(0, content - width), Math.max(0, offset + direction * width * 0.8)), animated: true });
  return <View style={{ minWidth: 0 }}>
    {desktop && content > width + 1 ? <View className="flex-row justify-end gap-2 mb-2" style={{ direction: 'ltr' }}>
      {([-1, 1] as const).map((d) => <Pressable key={d} testID={`carousel-${d === -1 ? 'previous' : 'next'}`} accessibilityRole="button" accessibilityLabel={t(d === -1 ? 'improve.previous' : 'improve.next')} disabled={d === -1 ? offset <= 1 : offset >= content - width - 1} onPress={() => scroll(d)} className="w-10 h-10 rounded-full border border-line bg-surface items-center justify-center" style={{ opacity: (d === -1 ? offset <= 1 : offset >= content - width - 1) ? 0.35 : 1 }}><Icon name={d === -1 ? 'chevron-left' : 'chevron-right'} /></Pressable>)}
    </View> : null}
    <ScrollView ref={ref} horizontal style={{ direction: 'ltr' }} showsHorizontalScrollIndicator={desktop} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} onContentSizeChange={(w) => setContent(w)} onScroll={(e) => setOffset(e.nativeEvent.contentOffset.x)} scrollEventThrottle={16} contentContainerStyle={{ gap, paddingBottom: desktop ? 10 : 0 }}>
      {children}
    </ScrollView>
  </View>;
}
