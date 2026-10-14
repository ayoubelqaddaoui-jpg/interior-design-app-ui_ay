import React from 'react';
import { Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { sorted, useStore } from '@/store/useStore';
import { useL, useT } from '@/i18n';
import { GridSelector } from '@/components/ui/GridSelector';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import type { Group } from '@/data/types';

/** Room type grid: icon OR image, per the admin's `displayMode`. Supports the NEW ribbon. */
export function StepRoom({ group, value, onChange }: { group: Group; value?: string; onChange: (id: string) => void }) {
  const { t, rtl } = useT();
  const L = useL();
  const rooms = useStore((s) => s.roomTypes);
  const list = sorted(rooms).filter((r) => r.visible && r.group === group);
  return (
    <View>
      <Txt className="text-[16px] font-bold mb-3">{t('wizard.roomTitle')}</Txt>
      <GridSelector items={list} cols={{ m: 2, t: 3, d: 4 }} gap={10} renderItem={(r) => {
        const on = value === r.id;
        return (
          <Pressable testID={`room-${r.id}`} onPress={() => onChange(r.id)} className={`rounded-xl overflow-hidden border-2 ${on ? 'border-primary bg-soft' : 'border-transparent bg-surface2'} active:opacity-80`} style={{ height: r.displayMode === 'image' ? 88 : 52 }}>
            {r.displayMode === 'image' ? (
              <>
                <Image source={{ uri: r.image }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} contentFit="cover" />
                <View className="absolute inset-0 bg-black/40" />
                <View className="flex-1 items-center justify-center px-2"><Txt className="text-white font-bold text-[13px] text-center">{L(r.title)}</Txt></View>
              </>
            ) : (
              <View className="flex-1 flex-row items-center justify-center gap-2 px-2">
                <Icon name={r.icon} size={18} tone={on ? 'fg' : 'muted'} />
                <Txt className="font-semibold text-[13.5px]" numberOfLines={1}>{L(r.title)}</Txt>
              </View>
            )}
            {r.isNew ? (
              <View pointerEvents="none" className="absolute top-0 end-0 w-12 h-12 overflow-hidden">
                <View className="absolute bg-danger items-center" style={{ top: 7, ...(rtl ? { left: -17 } : { right: -17 }), width: 62, transform: [{ rotate: rtl ? '-45deg' : '45deg' }] }}>
                  <Txt className="text-white text-[8px] font-black py-[1px]">{t('common.new')}</Txt>
                </View>
              </View>
            ) : null}
          </Pressable>
        );
      }} />
    </View>
  );
}
