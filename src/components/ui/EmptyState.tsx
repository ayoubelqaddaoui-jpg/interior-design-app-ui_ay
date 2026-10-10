import React from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Txt } from './Txt';
import { Icon } from './Icon';
import { Button } from './Button';

export function EmptyState({ icon = 'image-multiple-outline', title, subtitle, action, onAction }: { icon?: string; title: string; subtitle?: string; action?: string; onAction?: () => void }) {
  return (
    <Animated.View entering={FadeInDown.duration(350)} className="items-center py-16 px-8">
      <View className="w-20 h-20 rounded-full bg-soft items-center justify-center mb-4"><Icon name={icon} size={34} /></View>
      <Txt className="text-[17px] font-bold text-center">{title}</Txt>
      {subtitle ? <Txt className="text-muted text-center mt-1 text-[14px]">{subtitle}</Txt> : null}
      {action && onAction ? <Button title={action} onPress={onAction} className="mt-5" /> : null}
    </Animated.View>
  );
}
