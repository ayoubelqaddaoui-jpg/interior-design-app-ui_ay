import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { enablePush, disablePush, pushStatus, syncPushLanguage, type PushStatus } from '@/lib/push';
import { toast } from '@/store/useToast';

export function PushNotifications() {
  const { t, lang } = useT();
  const [status, setStatus] = useState<PushStatus>('disabled');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    pushStatus().then(value => { if (active) setStatus(value); }).catch(() => {});
    // Update only existing opt-ins; never prompt or create a subscription automatically.
    syncPushLanguage(lang).catch(() => {});
    return () => { active = false; };
  }, [lang]);
  const enable = async () => {
    setBusy(true);
    try { setStatus(await enablePush(lang)); }
    catch { toast(t('push.error')); }
    finally { setBusy(false); }
  };
  const disable = async () => {
    setBusy(true);
    try { await disablePush(); setStatus('disabled'); }
    catch { toast(t('push.error')); }
    finally { setBusy(false); }
  };
  return <Card testID="admin-push-panel" className="p-4 mb-4 gap-3">
    <Txt className="font-bold text-[16px]">{t('push.title')}</Txt>
    <Txt testID="push-status" className="text-muted text-[13px]">{t(`push.${status}`)}</Txt>
    <View className="flex-row flex-wrap gap-2">
      <Button testID="push-enable" title={t('push.enable')} icon="bell-outline" loading={busy} disabled={status === 'unsupported' || status === 'unconfigured' || status === 'blocked'} onPress={enable} />
      {status === 'enabled' ? <Button testID="push-disable" title={t('push.disable')} variant="soft" disabled={busy} onPress={disable} /> : null}
    </View>
    <Txt className="text-muted text-[12px]">{t('push.privacy')}</Txt>
  </Card>;
}
