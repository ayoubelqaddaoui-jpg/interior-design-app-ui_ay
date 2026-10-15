import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { Lang } from '@/data/types';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Txt } from '@/components/ui/Txt';
import { Sheet } from '@/components/ui/Sheet';
import { defaultMessage, renderMessage, returningRepo, type MessageText, type MessageVersion } from '@/lib/returning';
import { backendEnabled } from '@/lib/backend';
import { isRtl, useT } from '@/i18n';
import { useUserSession } from '@/store/useUserSession';
import { toast } from '@/store/useToast';

export function MessageCard({ text, lang, values, onPrimary, onLater }: { text: MessageText; lang: Lang; values?: { name?: string; price?: string; remaining?: number }; onPrimary?: () => void; onLater?: () => void }) {
  const message = renderMessage(text, lang, values);
  const style = { textAlign: isRtl(lang) ? 'right' as const : 'left' as const, writingDirection: isRtl(lang) ? 'rtl' as const : 'ltr' as const };
  return <Card testID={`returning-preview-${lang}`} className="p-5 gap-4" style={{ direction: isRtl(lang) ? 'rtl' : 'ltr' }}>
    <Txt className="font-black text-[24px]" style={style}>{message.headline}</Txt>
    <Txt className="text-muted text-[15px]" style={style}>{message.body}</Txt>
    {message.benefits.map((value, index) => <Txt key={index} style={style} className="font-semibold">✓ {value}</Txt>)}
    <Button testID={`returning-primary-${lang}`} title={message.primary} full onPress={onPrimary} />
    <Pressable testID={`returning-later-${lang}`} accessibilityRole="link" onPress={onLater} className="items-center py-2"><Txt className="text-muted underline">{message.secondary}</Txt></Pressable>
  </Card>;
}

/** Uses the existing responsive Sheet; demo always displays built-in copy, never saved experiments. */
export function ReturningPopup({ onContinue, onLater, onAssigned }: { onContinue: () => void; onLater: () => void; onAssigned: (id: string | null) => void }) {
  const { t, lang } = useT();
  const user = useUserSession(s => s.user);
  const [version, setVersion] = useState<MessageVersion | null>(null);
  const [loaded, setLoaded] = useState(!backendEnabled);
  const [busy, setBusy] = useState(false);
  const [recorded, setRecorded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await returningRepo.message();
        if (cancelled) return;
        if (!result.eligible) { onContinue(); return; }
        setVersion(result.version);
      } catch { /* A backend failure displays safe built-in text, not stale local variants. */ }
      finally { if (!cancelled) setLoaded(true); }
    };
    if (backendEnabled) void load();
    return () => { cancelled = true; };
  }, [onContinue]);
  useEffect(() => {
    if (!loaded) return;
    onAssigned(version?.id || null);
    if (version) void returningRepo.event(version.id, 'view').then(() => setRecorded(true)).catch(() => {});
  }, [loaded, version, onAssigned]);
  const primary = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (version) {
        if (!recorded) await returningRepo.event(version.id, 'view');
        await returningRepo.event(version.id, 'click');
      }
    } catch { toast(t('returning.tracking')); }
    finally { setBusy(false); onContinue(); }
  };
  return <Sheet visible onClose={onLater}>
    <View testID="returning-popup" className="gap-3">
      {loaded ? <MessageCard text={version?.texts[lang] || defaultMessage[lang]} lang={lang} values={{ name: user?.name, remaining: user?.credits }} onPrimary={() => { void primary(); }} onLater={onLater} /> : <Txt>{t('common.loading')}</Txt>}
      {busy ? <Txt>{t('common.loading')}</Txt> : null}
    </View>
  </Sheet>;
}
