import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, ConfirmSheet } from '@/components/ui';
import { CrudTable } from './CrudTable';
import { FormModal } from './FormModal';
import { AdminPage } from './AdminShell';
import { ENTITIES } from '@/admin/entities';
import { sorted, useStore } from '@/store/useStore';
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
  const [del, setDel] = useState<any | null>(null);
  const ctx = { s, L, t };
  const list = (cfg ? s[cfg.name as CollName] : []) as any[];
  const rows = useMemo(() => (cfg?.ordered ? sorted(list) : list), [cfg, list]);
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
  const remove = async (r: any) => {
    for (const [coll, fk] of cfg.cascade ?? []) {
      const ids = (useStore.getState()[coll] as any[]).filter((x) => x[fk] === r.id).map((x) => x.id);
      if (ids.length) await s.removeMany(coll, ids);
    }
    await s.remove(cfg.name, r.id);
  };

  return (
    <AdminPage title={t(`admin.nav.${cfg.navKey}`)} right={<Button testID="crud-add" icon="plus" size="sm" title={t('admin.crud.addNew')} onPress={() => open()} />}>
      <CrudTable rows={rows} cols={cfg.cols(ctx)} rowTestID="row"
        onEdit={open} onDelete={setDel}
        onMove={cfg.ordered ? (r, d) => s.move(cfg.name, r.id, d) : undefined}
        onToggle={(r) => s.update(cfg.name, r.id, { visible: r.visible === false } as any)} />
      <View className="h-6" />
      <FormModal visible={!!editing} title={`${isNew ? t('admin.crud.addNew') : t('admin.crud.editItem')} · ${t(`admin.nav.${cfg.navKey}`)}`}
        fields={cfg.fields(ctx)} initial={editing} onClose={() => setEditing(null)} onSubmit={submit} />
      <ConfirmSheet visible={!!del} onClose={() => setDel(null)} message={t('admin.crud.confirmDelete')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => del && remove(del)} />
    </AdminPage>
  );
}
