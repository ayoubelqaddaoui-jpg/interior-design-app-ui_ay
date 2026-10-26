import React from 'react';
import { Pressable, View } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

/** A titled settings card: icon chip + title (+ optional trailing action), tight content area. */
export function Section({ icon, title, right, children, testID }: { icon: string; title: string; right?: React.ReactNode; children: React.ReactNode; testID?: string }) {
  return (
    <Card testID={testID} className="p-3.5 mb-3">
      <View className="flex-row items-center gap-2.5 mb-3">
        <View className="w-8 h-8 rounded-lg bg-soft items-center justify-center"><Icon name={icon} size={18} tone="primary" /></View>
        <Txt className="flex-1 font-extrabold text-[15px]" accessibilityRole="header">{title}</Txt>
        {right}
      </View>
      {children}
    </Card>
  );
}

export function FieldLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View className="flex-row items-center justify-between mb-1.5 gap-2">
      <Txt className="text-[12px] font-bold text-muted flex-1">{children}</Txt>
      {right}
    </View>
  );
}

/** Large selectable tile (icon or custom visual + label). */
export function OptionTile({ selected, onPress, label, icon, visual, testID }: { selected: boolean; onPress: () => void; label: string; icon?: string; visual?: React.ReactNode; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={label} onPress={onPress}
      className={`flex-1 items-center justify-center rounded-xl border px-2 py-2.5 gap-1.5 active:opacity-80 ${selected ? 'border-primary bg-soft' : 'border-line bg-surface'}`} style={{ minWidth: 0 }}>
      {visual ?? (icon ? <Icon name={icon} size={22} tone={selected ? 'primary' : 'muted'} /> : null)}
      <Txt className={`text-[12px] font-bold ${selected ? '' : 'text-muted'}`} numberOfLines={1}>{label}</Txt>
    </Pressable>
  );
}

/** −/+ control with a progress track, so size and spacing can be tuned without typing. */
export function Stepper({ label, value, min, max, step, onChange, format, testID }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string; testID?: string }) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n * 100) / 100));
  const pct = ((value - min) / (max - min)) * 100;
  const btn = (name: string, delta: number, id: string, off: boolean) => (
    <Pressable testID={`${testID}-${id}`} accessibilityRole="button" accessibilityLabel={`${label} ${id === 'dec' ? '−' : '+'}`} disabled={off} onPress={() => onChange(clamp(value + delta))}
      className={`w-9 h-9 rounded-full items-center justify-center ${off ? 'bg-surface2 opacity-50' : 'bg-surface2 active:opacity-70'}`}><Icon name={name} size={18} /></Pressable>
  );
  return (
    <View testID={testID} style={{ flex: 1, minWidth: 0 }}>
      <FieldLabel right={<Txt className="text-[12px] font-extrabold" testID={`${testID}-value`}>{format ? format(value) : String(value)}</Txt>}>{label}</FieldLabel>
      <View className="flex-row items-center gap-2.5">
        {btn('minus', -step, 'dec', value <= min)}
        <View className="flex-1 h-2 rounded-full bg-surface2 overflow-hidden" style={{ direction: 'ltr' } as any}><View className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} /></View>
        {btn('plus', step, 'inc', value >= max)}
      </View>
    </View>
  );
}
