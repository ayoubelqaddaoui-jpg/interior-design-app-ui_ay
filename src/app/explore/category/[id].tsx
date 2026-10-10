import React from 'react';
import { Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { sorted, useStore } from '@/store/useStore';
import { useL, useT } from '@/i18n';
import { EmptyState, GridSelector, MediaView, PageHeader, Screen } from '@/components/ui';

export default function CategoryPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  const L = useL();
  const cat = useStore((s) => s.categories.find((x) => x.id === id));
  const items = useStore((s) => s.inspirations);
  const list = sorted(items).filter((i) => i.visible && i.categoryId === id);

  return (
    <Screen header={<PageHeader title={L(cat?.title)} onBack={() => router.back()} />} bottomInset={16}>
      {list.length === 0 ? <EmptyState title={t('explore.emptyCat')} /> : (
        <GridSelector items={list} cols={{ m: 2, t: 3, d: 4 }} gap={10} renderItem={(it) => (
          <Pressable testID={`ins-${it.id}`} onPress={() => router.push({ pathname: '/explore/item/[id]', params: { id: it.id } })}>
            <MediaView uri={it.image} className="rounded-xl" style={{ aspectRatio: 0.85 }} />
          </Pressable>
        )} />
      )}
    </Screen>
  );
}
