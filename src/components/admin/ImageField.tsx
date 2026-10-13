import React from 'react';
import { Pressable, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { MediaView } from '@/components/ui/MediaView';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { pickPhoto } from '@/lib/photo';

/** URL input + upload from gallery + preview. Used for every admin image. */
export function ImageField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const { t } = useT();
  const up = async () => { const r = await pickPhoto('gallery', { preserveTransparency: true }); if ('uri' in r) onChange(r.uri); };
  return (
    <View className="mb-3">
      <Txt className="text-[13px] font-semibold text-muted mb-1.5">{label}</Txt>
      <View className="flex-row gap-3 items-start">
        <MediaView uri={value || undefined} className="rounded-xl" style={{ width: 72, height: 72 }} />
        <View className="flex-1">
          <Input value={value.startsWith('data:') ? '(uploaded image)' : value} editable={!value.startsWith('data:')} onChangeText={onChange} placeholder="https://…" autoCapitalize="none" />
          <View className="flex-row flex-wrap gap-2 -mt-1">
            <Button title={t('admin.f.uploadImage')} icon="upload" variant="soft" size="sm" onPress={up} />
            {value ? <Pressable onPress={() => onChange('')} className="h-9 px-3 justify-center"><Txt className="text-danger font-bold text-[13px]">{t('admin.brand.remove')}</Txt></Pressable> : null}
          </View>
        </View>
      </View>
    </View>
  );
}
