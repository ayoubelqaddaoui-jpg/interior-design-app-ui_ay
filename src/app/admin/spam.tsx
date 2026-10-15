import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { AdminPage } from '@/components/admin/AdminShell';
import { CrudTable } from '@/components/admin/CrudTable';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';
import { api, backendEnabled } from '@/lib/backend';
import { useT } from '@/i18n';

type SpamRow = { phone: string; device: string; ip: string; imageHash: string; accounts: number; freeUsed: number; date: number };
type Report = { rows: SpamRow[]; total: number; flagged: number; percentage: number; page: number; pageSize: number; block: boolean };

export default function SpamMonitor() {
  const { t, lang } = useT();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filters, setFilters] = useState({ from: '', to: '', page: 1 });
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef(0);
  const load = useCallback(async () => {
    if (!backendEnabled) return;
    const sequence = ++request.current;
    setBusy(true); setError(false);
    try {
      const query = new URLSearchParams({ ...filters, page: String(filters.page) });
      const value = await api<Report>(`/admin/spam?${query}`);
      if (sequence === request.current) setReport(value);
    } catch { if (sequence === request.current) setError(true); }
    finally { if (sequence === request.current) setBusy(false); }
  }, [filters]);
  useEffect(() => { const timer = setTimeout(() => { void load(); }, 0); return () => { clearTimeout(timer); }; }, [load]);
  const toggle = async (block: boolean) => {
    if (busy) return;
    setBusy(true); setError(false);
    try { await api('/admin/spam', { method: 'PATCH', body: { block } }); await load(); }
    catch { setError(true); setBusy(false); }
  };
  const pages = Math.max(1, Math.ceil((report?.flagged || 0) / 20));
  const text = (value: string | number) => <Txt className="text-[12px]" selectable numberOfLines={2}>{String(value)}</Txt>;
  return <AdminPage title={t('spam.title')}>
    {!backendEnabled ? <Txt testID="spam-unavailable">{t('spam.unavailable')}</Txt> : <>
      <Card className="p-4 mb-4 gap-3">
        <View className="flex-row items-center justify-between gap-3">
          <Txt className="font-bold flex-1">{t('spam.block')}</Txt>
          <Toggle testID="spam-block" label={t('spam.block')} value={report?.block ?? false} onValueChange={value => { void toggle(value); }} disabled={busy || !report} />
        </View>
        <Txt className="text-muted text-[13px]">{t('spam.note')}</Txt>
        {report ? <Txt testID="spam-rate" className="font-bold">{t('spam.rate', { flagged: report.flagged, total: report.total, percentage: report.percentage.toFixed(1) })}</Txt> : null}
      </Card>
      <View className="flex-row flex-wrap items-center gap-3 mb-3">
        <View style={{ flexGrow: 1, minWidth: 145 }}><Input testID="spam-from" label={t('spam.from')} value={from} onChangeText={setFrom} placeholder="2026-01-01" /></View>
        <View style={{ flexGrow: 1, minWidth: 145 }}><Input testID="spam-to" label={t('spam.to')} value={to} onChangeText={setTo} placeholder="2026-12-31" /></View>
        <Button testID="spam-filter" title={t('spam.apply')} disabled={busy} onPress={() => setFilters({ from, to, page: 1 })} />
      </View>
      {error ? <View className="mb-3 gap-2"><Txt testID="spam-error" className="text-danger">{t('spam.error')}</Txt><Button title={t('common.retry')} onPress={() => { void load(); }} /></View> : null}
      {busy ? <Txt>{t('common.loading')}</Txt> : null}
      {report?.rows.length ? <CrudTable rowTestID="spam-client" rows={report.rows.map(row => ({ ...row, id: row.phone }))} cols={[
        { label: t('spam.phone'), render: row => text(row.phone), flex: 1.3 },
        { label: t('spam.device'), render: row => text(row.device) },
        { label: t('spam.ip'), render: row => text(row.ip) },
        { label: t('spam.hash'), render: row => text(row.imageHash) },
        { label: t('spam.accounts'), render: row => text(row.accounts), flex: 0.7 },
        { label: t('spam.freeUsed'), render: row => text(row.freeUsed), flex: 0.7 },
        { label: t('spam.date'), render: row => text(new Date(row.date).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'ar-MA')) },
      ]} /> : !busy && report ? <Txt testID="spam-empty">{t('spam.empty')}</Txt> : null}
      <View className="flex-row flex-wrap items-center justify-between gap-3 py-4">
        <Button testID="spam-previous" title={t('spam.previous')} variant="soft" disabled={busy || filters.page <= 1} onPress={() => setFilters(old => ({ ...old, page: old.page - 1 }))} />
        <Txt testID="spam-page">{t('spam.page', { page: filters.page, pages })}</Txt>
        <Button testID="spam-next" title={t('spam.next')} variant="soft" disabled={busy || filters.page >= pages} onPress={() => setFilters(old => ({ ...old, page: old.page + 1 }))} />
      </View>
    </>}
  </AdminPage>;
}
