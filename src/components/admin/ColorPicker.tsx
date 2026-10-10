import React from 'react';
import { Platform, TextInput, View } from 'react-native';
import { Txt } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

const SWATCHES = ['#FBDD2D', '#F59E0B', '#EF4444', '#EC4899', '#8B5CF6', '#2563EB', '#0B1B4D', '#06B6D4', '#16A34A', '#111111', '#6B7280', '#FFFFFF'];
const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

/** Native colour input on web, swatches + hex field everywhere. */
export function ColorPicker({ label, value, onChange }: { label?: string; value: string; onChange: (v: string) => void }) {
  const { colors } = useTheme();
  return (
    <View className="mb-4">
      {label ? <Txt className="text-[13px] font-semibold text-muted mb-1.5">{label}</Txt> : null}
      <View className="flex-row items-center gap-3">
        {Platform.OS === 'web'
          ? React.createElement('input', { type: 'color', value: isHex(value) ? value : '#000000', onChange: (e: any) => onChange(e.target.value.toUpperCase()), style: { width: 44, height: 44, border: 0, padding: 0, borderRadius: 12, background: 'none', cursor: 'pointer' } })
          : <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: isHex(value) ? value : '#000', borderWidth: 1, borderColor: colors.line }} />}
        <TextInput value={value} onChangeText={(v) => onChange(v.startsWith('#') ? v : '#' + v)} autoCapitalize="characters" maxLength={7}
          style={{ flex: 1, height: 44, borderRadius: 12, paddingHorizontal: 12, backgroundColor: colors.surface2, color: colors.fg, fontSize: 15, outlineStyle: 'none' } as any} />
      </View>
      <View className="flex-row flex-wrap gap-2 mt-2.5">
        {SWATCHES.map((c) => (
          <View key={c} onTouchEnd={() => onChange(c)} {...(Platform.OS === 'web' ? ({ onClick: () => onChange(c) } as any) : {})}
            style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: c, borderWidth: value.toUpperCase() === c ? 3 : 1, borderColor: value.toUpperCase() === c ? colors.fg : colors.line, ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}) }} />
        ))}
      </View>
    </View>
  );
}
