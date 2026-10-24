import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { BackendError, isBackendUnavailable } from '@/lib/backend';
import { sendTestPush, type PushStatus } from '@/lib/push';
import { setNotifications, useDevicePush, useOwnerPushStatus } from '@/lib/notifications';
import { useLocal } from '@/store/useLocal';
import { useStore } from '@/store/useStore';
import { toast } from '@/store/useToast';

/** "Notifications des nouvelles demandes": works in desktop browsers, Android browsers, installed iPhone web apps and the Android app. */
export function PushNotifications() {
  const { t, lang } = useT();
  const offline = useLocal(s => s.adminOffline);
  const paused = useStore(s => s.doc.settings.notifyAdmins === false);
  const status: PushStatus = useOwnerPushStatus('admin');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => useDevicePush.getState().refresh(), []);
  // Subscribing (silently, when the browser already allows it) and language updates are handled by the preference bindings.
  useEffect(() => { void refresh(); }, [refresh]);
  const failure = (error: unknown) => toast(t(error instanceof BackendError && error.status === 401 ? 'push.login' : isBackendUnavailable(error) ? 'push.unavailable' : 'push.error'));
  const enable = async () => {
    if (busy) return;
    setBusy(true);
    try { await setNotifications('admin', true, lang); }
    catch (error) { failure(error); void refresh(); }
    finally { setBusy(false); }
  };
  const disable = async () => {
    setBusy(true);
    try { await setNotifications('admin', false, lang); }
    catch (error) { failure(error); }
    finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true);
    try { const result = await sendTestPush(); toast(t(result.ok ? 'push.testSent' : 'push.testFailed')); }
    catch (error) { toast(t(error instanceof BackendError && error.code === 'NO_SUBSCRIPTION' ? 'push.testNone' : error instanceof BackendError && error.code === 'NOTIFICATIONS_OFF' ? 'inbox.offByAdmin' : 'push.testFailed')); }
    finally { setBusy(false); }
  };
  const blockedInfo = status === 'unsupported' || status === 'unconfigured' || status === 'blocked' || status === 'install';
  return <Card testID="admin-push-panel" className="p-4 mb-4 gap-3">
    <Txt className="font-bold text-[16px]">{t('push.title')}</Txt>
    <Txt testID="push-status" className="text-muted text-[13px]">{t(`push.${status}`)}</Txt>
    {paused ? <Txt testID="push-paused" className="text-danger text-[13px]">{t('inbox.offByAdmin')}</Txt> : null}
    {offline ? <Txt testID="push-offline" className="text-danger text-[13px]">{t('push.login')}</Txt> : null}
    <View className="flex-row flex-wrap gap-2">
      <Button testID="push-enable" title={t(status === 'enabled' ? 'push.renew' : 'push.enable')} icon="bell-outline" loading={busy} disabled={blockedInfo} onPress={() => { void enable(); }} />
      {status === 'enabled' ? <Button testID="push-test" title={t('push.test')} variant="soft" disabled={busy} onPress={() => { void test(); }} /> : null}
      {status === 'enabled' ? <Button testID="push-disable" title={t('push.disable')} variant="soft" disabled={busy} onPress={() => { void disable(); }} /> : null}
    </View>
    <Txt className="text-muted text-[12px]">{t('push.privacy')}</Txt>
  </Card>;
}
