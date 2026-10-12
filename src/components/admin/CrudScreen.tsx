import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, ConfirmSheet, Txt } from '@/components/ui';
import { CrudTable } from './CrudTable';
import { BatchFormModal, FormModal, validate } from './FormModal';
import { AdminPage } from './AdminShell';
import { HomeTabsOption } from './HomeTabsOption';
import { ENTITIES } from '@/admin/entities';
import { nextOrder, sorted, uid, useStore } from '@/store/useStore';
import { useL, useT } from '@/i18n';
import type { CollName } from '@/data/types';
import { toast } from '@/store/useToast';

/** The one generic CRUD screen: every admin entity is described by a config in `admin/entities.tsx`. */
export function CrudScreen({ entity }: { entity: string }) {
  const cfg = ENTITIES[entity];
  const { t } = useT();
  const L = useL();
  const s = useStore();
  const [editing, setEditing] = useState<any | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [batch, setBatch] = useState<'add' | 'edit' | null>(null);
  const [bulkDelete, setBulkDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const bulkEnabled = s.doc.settings.bulkPanels?.includes(entity) ?? false;
  const [del, setDel] = useState<any | null>(null);
  const ctx = { s, L, t };
  const list = cfg ? s[cfg.name as CollName] : undefined;
  const rows = useMemo(() => (cfg?.ordered ? sorted((list ?? []) as any[]) : list ?? []), [cfg, list]);
  if (!cfg) return null;

  const open = (r?: any) => { setIsNew(!r); setEditing(r ?? { ...cfg.blank(ctx) }); };
  const submit = async (v: any) => {
    if (cfg.name === 'models' && v.isDefault) {
      await Promise.all(s.models.filter((m) => m.isDefault && m.id !== v.id).map((m) => s.update('models', m.id, { isDefault: false })));
    }
    if (isNew) await s.create(cfg.name, v); else await s.update(cfg.name, v.id, v);
    setEditing(null);
    toast(t('admin.crud.saved'));
  };
  const removeRows = async (name: CollName, ids: string[]) => {
    for (const [child, fk] of ENTITIES[name]?.cascade ?? []) {
      const childIds = (useStore.getState()[child] as any[]).filter((x) => ids.includes(x[fk])).map((x) => x.id);
      if (childIds.length) await removeRows(child, childIds);
    }
    await s.removeMany(name, ids);
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); toast(t('admin.crud.saved')); } catch { toast(t('improve.saveError')); } finally { setBusy(false); }
  };
  const submitBatch = async (values: any[], keys: string[]) => {
    if (!bulkEnabled) return;
    if (batch === 'add') {
      if (cfg.name === 'models' && values.filter((v) => v.isDefault).length > 1) throw new Error('Only one default model is allowed');
      for (const v of values) {
        // Stable draft IDs make retries safe after partial storage failures.
        if (!(useStore.getState()[cfg.name as CollName] as any[]).some((row) => row.id === v.id)) {
          if (cfg.name === 'models' && v.isDefault) for (const m of useStore.getState().models.filter((m) => m.isDefault)) await s.update('models', m.id, { isDefault: false });
          await s.create(cfg.name, { ...v, order: nextOrder(useStore.getState()[cfg.name as CollName] as any[]) });
        }
      }
    } else {
      const patch = Object.fromEntries(keys.map((key) => [key, values[0][key]]));
      // A model collection can have only one default, never multiple defaults.
      if (cfg.name === 'models' && patch.isDefault && selected.length > 1) throw new Error('Only one default model is allowed');
      const targets = rows.filter((r) => selected.includes(r.id));
      if (targets.some((r) => Object.keys(validate(cfg.fields(ctx), { ...r, ...patch }, t)).length)) throw new Error('Invalid update');
      if (cfg.name === 'models' && patch.isDefault) for (const m of s.models.filter((m) => m.isDefault && !selected.includes(m.id))) await s.update('models', m.id, { isDefault: false });
      for (const r of targets) await s.update(cfg.name, r.id, patch);
    }
    setBatch(null); setSelected([]); toast(t('admin.crud.saved'));
  };

  return (
    <AdminPage title={t(`admin.nav.${cfg.navKey}`)} right={<Button testID="crud-add" icon="plus" size="sm" title={t('admin.crud.addNew')} onPress={() => open()} />}>
      {entity === 'tabs' ? <HomeTabsOption /> : null}
      {bulkEnabled ? <Card className="p-4 mb-4">
        <Txt className="font-bold mb-3">{t('improve.selected', { count: selected.length })}</Txt>
        <View className="flex-row flex-wrap gap-2">
          <Button size="sm" variant="soft" title={t('improve.selectAll')} disabled={busy} onPress={() => setSelected(rows.map((r) => r.id))} />
          <Button size="sm" variant="soft" title={t('improve.clearSelection')} disabled={!selected.length || busy} onPress={() => setSelected([])} />
          <Button testID="crud-batch-add" size="sm" icon="plus" title={t('improve.addMultiple')} disabled={busy} onPress={() => setBatch('add')} />
          <Button testID="crud-batch-edit" size="sm" variant="soft" title={t('improve.editMultiple')} disabled={!selected.length || busy} onPress={() => setBatch('edit')} />
          <Button testID="crud-batch-delete" size="sm" variant="soft" title={t('improve.deleteMultiple')} disabled={!selected.length || busy} onPress={() => setBulkDelete(true)} />
          {cfg.ordered ? ([-1, 1] as const).map((d) => <Button key={d} testID={`crud-batch-move-${d}`} size="sm" variant="soft" title={t(d === -1 ? 'improve.up' : 'improve.down')} disabled={!selected.length || busy} onPress={() => run(() => s.moveMany(cfg.name, selected, d))} />) : null}
        </View>
      </Card> : null}
      <CrudTable selected={selected} onSelect={bulkEnabled ? (id) => { if (!busy) setSelected((old) => old.includes(id) ? old.filter((x) => x !== id) : [...old, id]); } : undefined} rows={rows} cols={cfg.cols(ctx)} rowTestID="row"
        onEdit={open} onDelete={setDel}
        onMove={cfg.ordered && bulkEnabled ? (r, d) => s.move(cfg.name, r.id, d) : undefined}
        onToggle={(r) => s.update(cfg.name, r.id, { visible: r.visible === false } as any)} />
      <View className="h-6" />
      <FormModal visible={!!editing} title={`${isNew ? t('admin.crud.addNew') : t('admin.crud.editItem')} · ${t(`admin.nav.${cfg.navKey}`)}`}
        fields={cfg.fields(ctx)} initial={editing} onClose={() => setEditing(null)} onSubmit={submit} />
      <BatchFormModal mode={batch} title={`${t(batch === 'add' ? 'improve.addMultiple' : 'improve.editMultiple')} · ${t(`admin.nav.${cfg.navKey}`)}`} fields={cfg.fields(ctx)} initial={rows.find((r) => selected.includes(r.id))} blank={() => ({ ...cfg.blank({ ...ctx, s: useStore.getState() }), id: uid(cfg.name) })} onClose={() => setBatch(null)} onSubmit={submitBatch} />
      <ConfirmSheet visible={bulkDelete} onClose={() => setBulkDelete(false)} message={t('improve.deleteCount', { count: selected.length })} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => run(async () => { if (bulkEnabled) { await removeRows(cfg.name, selected); setSelected([]); } })} />
      <ConfirmSheet visible={!!del} onClose={() => setDel(null)} message={t('admin.crud.confirmDelete')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => del && run(() => removeRows(cfg.name, [del.id]))} />
    </AdminPage>
  );
}
