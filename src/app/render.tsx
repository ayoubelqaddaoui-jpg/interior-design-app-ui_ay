import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { router } from '@/hooks/useLeaveGuard';
import { useStore } from '@/store/useStore';
import { useWizard } from '@/store/useWizard';
import { services } from '@/data/repositories';
import { useT } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { RenderingView } from '@/components/result/RenderingView';
import { useUserSession } from '@/store/useUserSession';
import { BackendError } from '@/lib/backend';
import { useWizardGuard } from '@/hooks/useWizardGuard';
import { freshUser, needsPro } from '@/lib/credits';

/** Runs the (mock) render, then creates history/request entries and routes to the result or the WhatsApp success page. */
export default function RenderPage() {
  const { t } = useT();
  const w = useWizard();
  const me = useUserSession(s => s.user);
  useWizardGuard();
  const [state, setState] = useState({ progress: 0, stage: 0 });
  const [failed, setFailed] = useState(false);
  const started = useRef(false);
  const signal = useRef({ cancelled: false });

  const run = async () => {
    const st = useStore.getState();
    const wiz = useWizard.getState();
    let user = useUserSession.getState().user;
    if (!user) { router.replace('/lead'); return; }
    // Only a user with no free design AND no credits left sees the paywall (balance re-read from the server).
    if (user.freeUsed && !wiz.proSeen && !wiz.requestId) {
      user = (await freshUser()) ?? user;
      if (needsPro(user)) { router.replace({ pathname: '/pro', params: { generation: '1' } }); return; }
    }
    setFailed(false);
    signal.current = { cancelled: false };
    try {
      // Every generation is a request the admin is notified about. The server spends the free design or a
      // credit in the same step (idempotent per claim id), so a retry never charges twice.
      const firstFree = !user!.freeUsed || !!wiz.lead;
      if (!useWizard.getState().requestId) {
        const request = await st.create('requests', { id: wiz.claimId, userId: user!.id, name: user!.name, whatsapp: user!.whatsapp, photoUri: wiz.photoUri, draft: wiz.draft, status: 'pending', createdAt: Date.now() });
        useWizard.setState({ requestId: request.id, ...(firstFree ? { lead: { name: user!.name, whatsapp: user!.whatsapp } } : {}) });
      }
      // The credit is spent: a retry of this same generation must never bounce to the paywall.
      if (!firstFree) useWizard.setState({ proSeen: true });
      if (signal.current.cancelled) return;
      await useUserSession.getState().refresh();
      if (signal.current.cancelled) return;
      const { imageUri } = await services.render.render({ photoUri: wiz.photoUri, draft: wiz.draft }, (p) => setState(p), signal.current);
      if (signal.current.cancelled) return;
      const lead = useWizard.getState().lead;
      const fresh = useStore.getState();
      if (lead) {
        // First free render: deliver through WhatsApp (admin queue).
        const req = fresh.requests.find((r) => r.id === useWizard.getState().requestId);
        const auto = fresh.doc.settings.autoSendWhatsApp;
        const hist = await fresh.create('history', { id: wiz.claimId, claimId: wiz.claimId, userId: user!.id, before: wiz.photoUri, after: auto ? imageUri : undefined, status: auto ? 'done' : 'pending', draft: wiz.draft, createdAt: Date.now(), requestId: req?.id });
        if (req) {
          let status: 'pending' | 'delivered' = 'pending';
          if (auto) { await services.whatsapp.sendDesign({ whatsapp: lead.whatsapp, name: lead.name, imageUri }); status = 'delivered'; }
          await fresh.update('requests', req.id, { aiResult: imageUri, historyId: hist.id, status, autoSent: auto });
        }
        wiz.setLead(undefined);
        useWizard.setState({ dirty: false });
        router.replace('/lead-success');
        return;
      }
      const requestId = useWizard.getState().requestId;
      const hist = await fresh.create('history', { id: wiz.claimId, claimId: wiz.claimId, userId: user!.id, before: wiz.photoUri, after: imageUri, status: 'done', draft: wiz.draft, createdAt: Date.now(), requestId });
      // The design is shown in the app straight away, so the admin's request is already fulfilled.
      if (requestId) await fresh.update('requests', requestId, { aiResult: imageUri, historyId: hist.id, status: 'delivered', autoSent: true }).catch(() => {});
      useWizard.setState({ dirty: false });
      router.replace({ pathname: '/result/[id]', params: { id: hist.id } });
    } catch (error) {
      if (error instanceof BackendError && error.status === 402) { router.replace({ pathname: '/pro', params: { generation: '1' } }); return; }
      if (!signal.current.cancelled) setFailed(true);
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run();
    return () => { signal.current.cancelled = true; };
  // One generation per mount; retries explicitly call run with the same claim ID.
  }, []);

  if (!w.photoUri || !me) return <Redirect href="/" />;

  const cancel = () => router.dismissTo('/');
  return (
    <Screen max={560} scroll={false} padded>
      <View className="flex-1 justify-center py-6">
        <RenderingView photo={w.photoUri} progress={state.progress} stage={state.stage} />
        <View className="mt-8 items-center gap-3">
          {failed ? <Button testID="render-retry" title={t('common.retry')} onPress={() => { setState({ progress: 0, stage: 0 }); run(); }} /> : null}
          <Button testID="render-cancel" variant="ghost" title={t('render.cancel')} onPress={cancel} />
        </View>
      </View>
    </Screen>
  );
}
