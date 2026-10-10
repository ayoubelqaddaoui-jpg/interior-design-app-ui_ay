import React from 'react';
import { Pressable, View } from 'react-native';
import { useL, useT } from '@/i18n';
import { EmptyState, Icon, Txt } from '@/components/ui';
import type { AiModel } from '@/data/types';

export function StepModel({ models, value, onChange }: { models: AiModel[]; value?: string; onChange: (id: string) => void }) {
  const { t } = useT();
  void useL;
  return (
    <View>
      <Txt className="text-[16px] font-bold mb-3">{t('wizard.modelTitle')}</Txt>
      {models.length === 0 ? <EmptyState icon="robot-outline" title={t('wizard.noModels')} /> : null}
      {models.map((m) => {
        const on = value === m.id;
        return (
          <Pressable key={m.id} testID={`model-${m.id}`} onPress={() => onChange(m.id)} className={`flex-row items-center gap-3 rounded-xl p-4 mb-2.5 border-2 ${on ? 'border-primary bg-soft' : 'border-transparent bg-surface2'} active:opacity-80`}>
            <View className="w-10 h-10 rounded-full bg-surface items-center justify-center"><Icon name="creation" size={20} /></View>
            <View className="flex-1">
              <Txt className="font-extrabold text-[15px]">{m.name}</Txt>
              <Txt className="text-muted text-[12px]">{m.provider}{m.isDefault ? ` · ${t('wizard.modelDefault')}` : ''}</Txt>
            </View>
            <View className={`w-6 h-6 rounded-full border-2 items-center justify-center ${on ? 'border-ink bg-ink' : 'border-line'}`}>{on ? <Icon name="check" size={14} tone="onink" /> : null}</View>
          </Pressable>
        );
      })}
    </View>
  );
}
