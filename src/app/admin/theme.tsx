import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Card, Icon, Txt } from '@/components/ui';
import { AdminPage } from '@/components/admin/AdminShell';
import { ColorPicker } from '@/components/admin/ColorPicker';
import { useBp } from '@/hooks/useBp';
import { useT } from '@/i18n';
import { useStore } from '@/store/useStore';
import { ThemeScope } from '@/theme/ThemeProvider';
import { CUSTOM_KEYS, THEMES } from '@/theme/tokens';
import { toast } from '@/store/useToast';
import type { ThemeConfig, ThemeId } from '@/data/types';

const IDS: ThemeId[] = ['light', 'dark', 'royal', 'custom'];
const CKEY: Record<string, string> = { primary: 'colorPrimary', bg: 'colorBg', surface: 'colorSurface', fg: 'colorFg', ink: 'colorInk' };

function Preview() {
  const { t } = useT();
  return (
    <View className="flex-1 p-4 gap-3 rounded-2xl" style={{ minHeight: 300 }}>
      <View className="flex-row items-center justify-between">
        <Txt className="font-extrabold text-[18px]">Dwira</Txt>
        <View className="bg-primary rounded-full px-3 h-8 flex-row items-center gap-1.5"><Icon name="star-four-points" size={14} tone="onprimary" /><Txt className="text-onprimary font-bold text-[13px]">1</Txt></View>
      </View>
      <View className="bg-surface border border-line rounded-2xl p-3">
        <View className="h-20 rounded-xl bg-surface2 mb-2" />
        <Txt className="font-bold">{t('admin.theme.title')}</Txt>
        <Txt className="text-muted text-[12px] mb-3">{t('admin.theme.preview')}</Txt>
        <View className="bg-ink rounded-full h-10 items-center justify-center"><Txt className="text-onink font-bold">{t('common.try')}</Txt></View>
      </View>
      <View className="flex-row gap-2">
        <View className="bg-primary rounded-full px-4 h-9 items-center justify-center"><Txt className="text-onprimary font-bold text-[13px]">{t('common.save')}</Txt></View>
        <View className="bg-soft rounded-full px-4 h-9 items-center justify-center"><Txt className="font-bold text-[13px]">{t('common.new')}</Txt></View>
      </View>
    </View>
  );
}

export default function ThemeAdmin() {
  const { t } = useT();
  const { desktop } = useBp();
  const saved = useStore((s) => s.doc.theme);
  const [cfg, setCfg] = useState<ThemeConfig>({ active: saved.active, custom: { primary: THEMES.light.primary, bg: THEMES.light.bg, surface: THEMES.light.surface, fg: THEMES.light.fg, ink: THEMES.light.ink, ...saved.custom } });
  const save = async () => { await useStore.getState().patchDoc('theme', cfg); toast(t('admin.crud.saved')); };
  return (
    <AdminPage title={t('admin.theme.title')}>
      <View className={desktop ? 'flex-row gap-6 items-start' : 'gap-5'}>
        <Card className="p-5 flex-1">
          <View className="flex-row flex-wrap gap-2 mb-5">
            {IDS.map((id) => (
              <Pressable key={id} testID={`theme-${id}`} onPress={() => setCfg((c) => ({ ...c, active: id }))}
                className={`px-4 h-10 rounded-full flex-row items-center gap-2 ${cfg.active === id ? 'bg-primary' : 'bg-surface2'}`}>
                {id !== 'custom' ? <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: THEMES[id].bg, borderWidth: 1, borderColor: '#9993' }} /> : <Icon name="palette-outline" size={16} tone={cfg.active === id ? 'onprimary' : 'fg'} />}
                <Txt className={`font-bold text-[14px] ${cfg.active === id ? 'text-onprimary' : ''}`}>{t(`admin.theme.${id}`)}</Txt>
              </Pressable>
            ))}
          </View>
          {cfg.active === 'custom' ? CUSTOM_KEYS.map((k) => (
            <ColorPicker key={k} label={t(`admin.theme.${CKEY[k]}`)} value={cfg.custom[k]} onChange={(v) => setCfg((c) => ({ ...c, custom: { ...c.custom, [k]: v } }))} />
          )) : null}
          <Button testID="theme-save" title={t('common.save')} onPress={save} className="mt-2" />
        </Card>
        <View style={{ width: desktop ? 340 : '100%' }}>
          <Txt className="text-muted text-[13px] font-semibold mb-2">{t('admin.theme.preview')}</Txt>
          <View className="rounded-2xl overflow-hidden border border-line" testID="theme-preview"><ThemeScope config={cfg} className="flex-none"><Preview /></ThemeScope></View>
        </View>
      </View>
    </AdminPage>
  );
}
