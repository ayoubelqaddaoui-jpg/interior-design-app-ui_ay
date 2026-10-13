import React from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { Txt, useAppFont } from './Txt';
import { useTheme } from '@/theme/ThemeProvider';

export function Input({ label, error, className = '', language, ...p }: TextInputProps & { label?: string; error?: string; className?: string; language?: string }) {
  const { colors } = useTheme();
  const fontFamily = useAppFont(language);
  return (
    <View className="mb-3">
      {label ? <Txt className="text-[13px] font-semibold text-muted mb-1.5">{label}</Txt> : null}
      <TextInput
        placeholderTextColor={colors.muted}
        {...p}
        className={`bg-surface2 text-fg rounded-xl px-4 min-h-[44px] text-[16px] border ${error ? 'border-danger' : 'border-transparent'} ${className}`}
        style={[{ fontFamily, color: colors.fg, minWidth: 0, width: '100%', flexGrow: 0, flexShrink: 0, height: p.multiline ? undefined : 44, paddingVertical: 10, textAlign: undefined, outlineStyle: 'none' } as any, p.style]}
      />
      {error ? <Txt className="text-danger text-[12px] mt-1">{error}</Txt> : null}
    </View>
  );
}
