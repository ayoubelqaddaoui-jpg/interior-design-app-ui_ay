import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AdminPage } from '@/components/admin/AdminShell';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';
import { ConfirmSheet } from '@/components/ui/Sheet';
import { MessageCard } from '@/components/ReturningMessage';
import { LANGS, isRtl, useT } from '@/i18n';
import type { Lang } from '@/data/types';
import { backendEnabled } from '@/lib/backend';
import { defaultMessage, messageLimits, returningRepo, sanitizeVersions, type MessageVersion, type MessageResult, type MessageText } from '@/lib/returning';
import { uid } from '@/lib/uid';
import { toast } from '@/store/useToast';
import { router, useBackCheckpoint, useLeaveGuard } from '@/hooks/useLeaveGuard';

export default function ReturningEditor() {
  const { t } = useT();
  const [rows, setRows] = useState<MessageVersion[]>([]);
  const [saved, setSaved] = useState<MessageVersion[]>([]);
  const [selected, setSelected] = useState('');
  const [language, setLanguage] = useState<Lang>('dar');
  const [device, setDevice] = useState<'mobile' | 'desktop'>('mobile');
  const [loaded, setLoaded] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [deleting, setDeleting] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [results, setResults] = useState<MessageResult[]>([]);
  const dirty = JSON.stringify(rows) !== JSON.stringify(saved);
  useEffect(() => {
    let cancelled = false;
    void returningRepo.list().then(value => {
      if (!cancelled) { setRows(value); setSaved(value); setSelected(value[0]?.id || ''); setLoaded(true); setError(false); }
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [reload]);
  const loadResults = async () => {
    if (!backendEnabled) return;
    try { setResults(await returningRepo.results(from, to)); setError(false); }
    catch { setError(true); }
  };
  useEffect(() => {
    if (!backendEnabled) return;
    let cancelled = false;
    void returningRepo.results('', '').then(value => { if (!cancelled) setResults(value); }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);
  const save = async () => {
    if (!loaded || busy) return false;
    const active = rows.filter(row => row.enabled);
    if (active.length > 1 && active.reduce((n, row) => n + row.weight, 0) !== 100) { setError(true); return false; }
    const clean = sanitizeVersions(rows);
    if (clean.some(row => LANGS.some(lang => ['headline', 'body', 'primary', 'secondary'].some(key => !row.texts[lang][key as keyof MessageText])))) { toast(t('returning.required')); return false; }
    setBusy(true);
    try {
      const value = await returningRepo.save(clean);
      setRows(value); setSaved(value); setError(false); toast(t('returning.saved'));
      await loadResults();
      return true;
    } catch { setError(true); return false; }
    finally { setBusy(false); }
  };
  const discard = () => { setRows(saved); setSelected(saved[0]?.id || ''); };
  useLeaveGuard(dirty, save, discard, { before: saved, after: rows });
  useBackCheckpoint(dirty, () => router.back());
  const version = rows.find(row => row.id === selected);
  const patch = (value: Partial<MessageVersion>) => setRows(old => old.map(row => row.id === selected ? { ...row, ...value } : row));
  const patchText = (value: Partial<MessageText>) => { if (version) patch({ texts: { ...version.texts, [language]: { ...version.texts[language], ...value } } }); };
  const add = (source?: MessageVersion) => {
    const used = new Set(rows.map(row => row.label));
    const label = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find(value => !used.has(value)) || String(rows.length + 1);
    const row: MessageVersion = { id: uid('returning'), label, enabled: false, weight: 0, texts: JSON.parse(JSON.stringify(source?.texts || defaultMessage)) };
    setRows(old => [...old, row]); setSelected(row.id);
  };
  const best = results.filter(row => row.views > 0).reduce<MessageResult | null>((winner, row) => !winner || row.conversion > winner.conversion ? row : winner, null);
  const editText = version?.texts[language];
  return <AdminPage title={t('returning.title')}>
    <View testID="returning-editor" className="gap-4">
      {!backendEnabled ? <Card className="p-4"><Txt testID="returning-demo-note" className="font-bold">{t('returning.connect')}</Txt></Card> : null}
      <Txt className="text-muted">{t('returning.weights')}</Txt>
      <Txt className="text-muted text-[12px]">{t('returning.stable')}</Txt>
      {error ? <View className="gap-2"><Txt testID="returning-error" className="text-danger">{t('returning.error')}</Txt>{!loaded ? <Button title={t('common.retry')} onPress={() => setReload(n => n + 1)} /> : null}</View> : null}
      {!loaded ? <Txt>{t('common.loading')}</Txt> : <>
        <View className="flex-row flex-wrap gap-2">
          {rows.map(row => <Button key={row.id} testID={`returning-select-${row.label}`} title={row.label} variant={selected === row.id ? 'primary' : 'soft'} onPress={() => setSelected(row.id)} />)}
          <Button testID="returning-add" title={t('returning.add')} disabled={busy || rows.length >= 26} onPress={() => add()} />
        </View>
        {!version ? <Txt>{t('returning.empty')}</Txt> : <Card className="p-4 gap-3">
          <View className="flex-row flex-wrap gap-3 items-center">
            <Txt className="font-bold">{t('returning.label')} {version.label}</Txt>
            <Toggle testID="returning-enabled" label={t('returning.enabled')} value={version.enabled} onValueChange={enabled => patch({ enabled })} disabled={busy} />
            <Button testID="returning-duplicate" title={t('returning.duplicate')} variant="soft" disabled={busy || rows.length >= 26} onPress={() => add(version)} />
            <Button testID="returning-delete" title={t('common.delete')} variant="ghost" disabled={busy} onPress={() => setDeleting(version.id)} />
          </View>
          <Input testID="returning-weight" editable={!busy} label={t('returning.weight')} value={String(version.weight)} keyboardType="number-pad" maxLength={3} onChangeText={value => patch({ weight: Math.max(0, Math.min(100, Number(value.replace(/\D/g, '')) || 0)) })} />
          <View className="flex-row flex-wrap gap-2">{LANGS.map(lang => <Button key={lang} testID={`returning-lang-${lang}`} title={{ dar: 'الدارجة', ar: 'العربية', fr: 'Français' }[lang]} variant={language === lang ? 'primary' : 'soft'} onPress={() => setLanguage(lang)} />)}</View>
          <Txt className="text-muted text-[12px]">{t('returning.variables')}</Txt>
          {editText ? <View style={{ direction: isRtl(language) ? 'rtl' : 'ltr' }}>
            {(['headline', 'body', 'primary', 'secondary'] as const).map(key => <Input key={key} testID={`returning-${key}`} editable={!busy} language={language} label={`${t(`returning.${key}`)} · ${messageLimits[key]}`} value={editText[key]} maxLength={messageLimits[key]} multiline={key === 'body'} style={{ textAlign: isRtl(language) ? 'right' : 'left' }} onChangeText={value => patchText({ [key]: value })} />)}
            <Txt className="font-bold mb-2">{t('returning.benefits')}</Txt>
            {Array.from({ length: 4 }, (_, index) => <Input key={index} testID={`returning-benefit-${index}`} editable={!busy} language={language} label={`${index + 1} · ${messageLimits.benefit}`} value={editText.benefits[index] || ''} maxLength={messageLimits.benefit} style={{ textAlign: isRtl(language) ? 'right' : 'left' }} onChangeText={value => { const benefits = [...editText.benefits]; while (benefits.length <= index) benefits.push(''); benefits[index] = value; patchText({ benefits }); }} />)}
          </View> : null}
        </Card>}
        <View className="flex-row flex-wrap gap-2">
          <Button testID="returning-save" title={t('common.save')} loading={busy} disabled={!dirty} onPress={() => { void save(); }} />
          <Button testID="returning-discard" title={t('improve.discard')} variant="soft" disabled={!dirty || busy} onPress={discard} />
        </View>
        <Txt className="font-bold text-[18px]">{t('returning.preview')}</Txt>
        <View className="flex-row flex-wrap gap-2">{(['mobile', 'desktop'] as const).map(value => <Button key={value} testID={`returning-device-${value}`} title={t(`returning.${value}`)} variant={device === value ? 'primary' : 'soft'} onPress={() => setDevice(value)} />)}</View>
        <View className="gap-4" style={{ width: '100%', maxWidth: device === 'mobile' ? 375 : 760, alignSelf: 'center' }}>
          {LANGS.map(lang => <View key={lang} className="gap-2"><Txt className="font-bold">{{ dar: 'الدارجة', ar: 'العربية', fr: 'Français' }[lang]}</Txt><MessageCard text={version?.texts[lang] || defaultMessage[lang]} lang={lang} values={{ name: lang === 'fr' ? 'Samira' : 'سميرة', remaining: 0 }} /></View>)}
        </View>
      </>}
      {backendEnabled ? <Card className="p-4 gap-3">
        <Txt className="font-bold text-[18px]">{t('returning.results')}</Txt>
        <Txt className="text-muted text-[12px]">{t('returning.metric')}</Txt>
        <Txt className="text-muted text-[12px]">{t('returning.reliability')}</Txt>
        <View className="flex-row flex-wrap gap-2 items-center">
          <View style={{ flexGrow: 1, minWidth: 130 }}><Input testID="returning-from" label={t('spam.from')} value={from} onChangeText={setFrom} placeholder="YYYY-MM-DD" maxLength={10} /></View>
          <View style={{ flexGrow: 1, minWidth: 130 }}><Input testID="returning-to" label={t('spam.to')} value={to} onChangeText={setTo} placeholder="YYYY-MM-DD" maxLength={10} /></View>
          <Button testID="returning-filter" title={t('spam.apply')} onPress={() => { void loadResults(); }} />
        </View>
        {results.map(row => <View key={row.id} testID={`returning-result-${row.label}`} className={`p-3 rounded-xl border gap-1 ${best?.id === row.id ? 'border-primary bg-soft' : 'border-line'}`}>
          <Txt className="font-bold">{row.label}{row.deleted ? ` · ${t('returning.deleted')}` : ''}{best?.id === row.id ? ` · ${t('returning.best')}` : ''}</Txt>
          <Txt>{t('returning.views')}: {row.views} · {t('returning.clicks')}: {row.clicks}</Txt>
          <Txt>{t('returning.purchases')}: {row.purchases} · {t('returning.conversion')}: {row.conversion.toFixed(1)}%</Txt>
        </View>)}
      </Card> : null}
    </View>
    <ConfirmSheet visible={!!deleting} onClose={() => setDeleting('')} message={t('returning.delete')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => { setRows(old => old.filter(row => row.id !== deleting)); setSelected(rows.find(row => row.id !== deleting)?.id || ''); }} />
  </AdminPage>;
}
