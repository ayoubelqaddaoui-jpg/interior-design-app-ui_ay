import React from 'react';
import { Pressable, View } from 'react-native';
import { Txt } from './Txt';
import { Icon } from './Icon';
import { useT } from '@/i18n';

/** Wizard header: back / title / close + segmented progress ("Step 2/4"). */
export function StepHeader({ title, step, total, onBack, onClose }: { title: string; step: number; total: number; onBack?: () => void; onClose: () => void }) {
  const { t } = useT();
  return (
    <View className="pt-2 pb-3">
      <View className="flex-row items-center justify-between h-11">
        <View className="w-11">{onBack ? <Pressable testID="step-back" onPress={onBack} hitSlop={10} className="w-10 h-10 items-center justify-center"><Icon name="chevron-left" size={28} flip /></Pressable> : null}</View>
        <Txt className="text-[18px] font-extrabold">{title}</Txt>
        <View className="w-11 items-end"><Pressable testID="step-close" onPress={onClose} hitSlop={10} className="w-10 h-10 items-center justify-center"><Icon name="close" size={24} /></Pressable></View>
      </View>
      <Txt className="text-muted text-[12px] mb-1.5">{t('wizard.step', { n: step, total })}</Txt>
      <View className="flex-row gap-1.5">
        {Array.from({ length: total }).map((_, i) => (
          <View key={i} className={`flex-1 h-[3px] rounded-full ${i < step ? 'bg-ink' : 'bg-line'}`} />
        ))}
      </View>
    </View>
  );
}

export function PageHeader({ title, onBack, right }: { title: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <View className="flex-row items-center h-14">
      <View className="w-11">{onBack ? <Pressable testID="page-back" onPress={onBack} hitSlop={10} className="w-10 h-10 items-center justify-center"><Icon name="chevron-left" size={28} flip /></Pressable> : null}</View>
      <Txt className="text-[19px] font-extrabold flex-1 text-center" numberOfLines={1}>{title}</Txt>
      <View className="min-w-[44px] items-end">{right}</View>
    </View>
  );
}
