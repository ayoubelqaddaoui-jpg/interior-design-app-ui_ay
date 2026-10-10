import React from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { Txt } from './Txt';
import { useTheme } from '@/theme/ThemeProvider';

export function Input({ label, error, className = '', ...p }: TextInputProps & { label?: string; error?: string; className?: string }) {
  const { colors } = useTheme();
  return (
    <View className="mb-3">
      {label ? <Txt className="text-[13px] font-semibold text-muted mb-1.5">{label}</Txt> : null}
      <TextInput
        placeholderTextColor={colors.muted}
        {...p}
        className={`bg-surface2 text-fg rounded-xl px-4 min-h-[48px] text-[16px] border ${error ? 'border-danger' : 'border-transparent'} ${className}`}
        style={[{ color: colors.fg, textAlign: undefined, outlineStyle: 'none' } as any, p.style]}
      />
      {error ? <Txt className="text-danger text-[12px] mt-1">{error}</Txt> : null}
    </View>
  );
}
