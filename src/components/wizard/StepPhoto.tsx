import React, { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { Icon, Sheet, Txt } from '@/components/ui';
import { tArr, useT } from '@/i18n';
import { pickPhoto } from '@/lib/photo';
import { toast } from '@/store/useToast';

export function StepPhoto({ photo, onChange }: { photo: string; onChange: (uri: string) => void }) {
  const { t } = useT();
  const [sheet, setSheet] = useState(false);
  const [tips, setTips] = useState(false);

  const pick = async (src: 'camera' | 'gallery') => {
    setSheet(false);
    const r = await pickPhoto(src);
    if ('uri' in r) onChange(r.uri);
    else if (r.error === 'permission') toast(t('wizard.permission'));
  };

  return (
    <View>
      <Txt className="text-[16px] font-bold mb-3">{t('wizard.uploadTitle')}</Txt>
      {photo ? (
        <Animated.View entering={ZoomIn.duration(250)} className="rounded-2xl overflow-hidden bg-surface2" style={{ aspectRatio: 1.25 }}>
          <Image source={{ uri: photo }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={Platform.OS === 'web' ? 0 : 200} />
          <Pressable testID="remove-photo" accessibilityLabel={t('wizard.removePhoto')} onPress={() => onChange('')} className="absolute top-3 end-3 w-8 h-8 rounded-full bg-danger items-center justify-center active:opacity-80">
            <Icon name="minus" size={20} color="#fff" />
          </Pressable>
        </Animated.View>
      ) : (
        <View className="rounded-2xl border border-dashed border-line bg-surface2/50 items-center justify-center" style={{ aspectRatio: 1.05 }}>
          <Pressable onPress={() => setTips(true)} className="absolute top-3 end-3 flex-row items-center gap-1 active:opacity-60">
            <Txt className="text-muted text-[12px]">{t('wizard.tipsTitle')}</Txt>
            <Icon name="information-outline" size={16} tone="muted" />
          </Pressable>
          <Pressable testID="add-photo" onPress={() => setSheet(true)} className="flex-row items-center gap-2 bg-ink rounded-full px-5 h-12 active:opacity-80">
            <Txt className="text-onink font-bold text-[15px]">{t('wizard.addPhoto')}</Txt>
            <View className="w-6 h-6 rounded-full bg-primary items-center justify-center"><Icon name="plus" size={16} tone="onprimary" /></View>
          </Pressable>
          <Txt className="text-muted text-[12px] text-center mt-4 px-8">{t('wizard.photoNote')}</Txt>
        </View>
      )}

      <Sheet visible={sheet} onClose={() => setSheet(false)} title={t('wizard.selectPhoto')}>
        <View className="flex-row gap-3">
          {(['camera', 'gallery'] as const).map((k) => (
            <Pressable key={k} testID={`pick-${k}`} onPress={() => pick(k)} className="flex-1 items-center justify-center py-6 rounded-2xl bg-surface2 active:opacity-70">
              <Icon name={k === 'camera' ? 'camera-outline' : 'image-multiple-outline'} size={30} />
              <Txt className="font-bold mt-2">{t(`wizard.${k}`)}</Txt>
            </Pressable>
          ))}
        </View>
      </Sheet>

      <Sheet visible={tips} onClose={() => setTips(false)} title={t('wizard.tipsTitle')}>
        {tArr(t, 'wizard.tips').map((x, i) => (
          <Animated.View key={i} entering={FadeIn.delay(i * 80)} className="flex-row items-start gap-3 mb-3">
            <View className="w-7 h-7 rounded-full bg-primary items-center justify-center"><Txt className="text-onprimary font-extrabold text-[13px]">{i + 1}</Txt></View>
            <Txt className="flex-1 text-[15px] pt-0.5">{x}</Txt>
          </Animated.View>
        ))}
      </Sheet>
    </View>
  );
}
