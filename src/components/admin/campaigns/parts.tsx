import React from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { BackendError } from '@/lib/backend';
import type { CampaignStatus } from '@/store/useAdminCampaigns';

/** Selectable pill used for segments, days, events. */
export function Chip({ label, on, onPress, testID, icon, sub }: { label: string; on: boolean; onPress: () => void; testID?: string; icon?: string; sub?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={onPress}
      className={`flex-row items-center gap-1.5 rounded-full border px-3 h-9 active:opacity-80 ${on ? 'bg-ink border-ink' : 'bg-surface border-line'}`}>
      {icon ? <Icon name={icon} size={15} tone={on ? 'onink' : 'muted'} /> : null}
      <Txt className={`text-[13px] font-bold ${on ? 'text-onink' : ''}`} numberOfLines={1}>{label}</Txt>
      {sub ? <Txt className={`text-[11px] font-semibold ${on ? 'text-onink' : 'text-muted'}`}>{sub}</Txt> : null}
    </Pressable>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <View className="mb-5">
      <Txt className="font-extrabold text-[14px]">{title}</Txt>
      {hint ? <Txt className="text-muted text-[12px] mt-0.5">{hint}</Txt> : null}
      <View className="mt-2.5 gap-2.5">{children}</View>
    </View>
  );
}

const TONE: Record<CampaignStatus, { dot: string; text: string }> = {
  draft: { dot: 'bg-muted', text: 'text-muted' }, scheduled: { dot: 'bg-primary', text: 'text-fg' }, sending: { dot: 'bg-primary', text: 'text-fg' },
  sent: { dot: 'bg-success', text: 'text-success' }, active: { dot: 'bg-success', text: 'text-success' }, paused: { dot: 'bg-muted', text: 'text-muted' }, ended: { dot: 'bg-muted', text: 'text-muted' },
};
export function StatusPill({ status, testID }: { status: CampaignStatus; testID?: string }) {
  const { t } = useT();
  const tone = TONE[status];
  return (
    <View className="flex-row items-center gap-1.5 rounded-full bg-surface2 px-2.5 h-6">
      <View className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
      <Txt testID={testID} className={`text-[11.5px] font-bold ${tone.text}`}>{t(`camp.status.${status}`)}</Txt>
    </View>
  );
}

/** Human message for a failed request (the server answers with stable error codes). */
export function useCampaignError() {
  const { t } = useT();
  return (error: unknown) => {
    const code = error instanceof BackendError ? error.code : '';
    const key = `camp.err.${code}`;
    const text = code ? t(key) : '';
    return text && text !== key ? text : t('camp.err.default');
  };
}

/** A tiny push-notification look-alike used by the composer preview. */
export function NotificationPreview({ title, body, lang }: { title: string; body: string; lang: 'dar' | 'ar' | 'fr' }) {
  const rtl = lang !== 'fr';
  return (
    <View testID="camp-preview" className="rounded-2xl bg-surface border border-line p-3 flex-row gap-3 items-start" style={{ direction: rtl ? 'rtl' : 'ltr' } as any}>
      <View className="w-9 h-9 rounded-xl bg-primary items-center justify-center"><Icon name="home-variant-outline" size={20} tone="onprimary" /></View>
      <View className="flex-1 gap-0.5" style={{ minWidth: 0 }}>
        <View className="flex-row items-center justify-between">
          <Txt className="text-[11px] text-muted font-semibold">Dwira</Txt>
          <Txt className="text-[11px] text-muted">now</Txt>
        </View>
        <Txt testID="camp-preview-title" className="font-bold text-[14px]" numberOfLines={2}>{title || '…'}</Txt>
        <Txt testID="camp-preview-body" className="text-[13px] text-muted" numberOfLines={3}>{body || '…'}</Txt>
      </View>
    </View>
  );
}
