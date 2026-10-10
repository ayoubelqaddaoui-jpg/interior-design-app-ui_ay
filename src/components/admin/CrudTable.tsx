import React from 'react';
import { Pressable, View } from 'react-native';
import { Card, EmptyState, Icon, Txt } from '@/components/ui';
import { useBp } from '@/hooks/useBp';
import { useT } from '@/i18n';

export type Col<T> = { label: string; flex?: number; render: (item: T) => React.ReactNode };

/** Table on desktop, stacked cards on mobile. Same data/props. */
export function CrudTable<T extends { id: string; visible?: boolean }>({ rows, cols, onEdit, onDelete, onMove, onToggle, rowTestID }: {
  rows: T[]; cols: Col<T>[]; onEdit?: (r: T) => void; onDelete?: (r: T) => void; onMove?: (r: T, d: -1 | 1) => void; onToggle?: (r: T) => void; rowTestID?: string;
}) {
  const { desktop } = useBp();
  const { t } = useT();
  if (!rows.length) return <EmptyState icon="database-off-outline" title={t('admin.crud.noItems')} />;
  const actions = (r: T, i: number) => (
    <View className="flex-row items-center gap-1">
      {onMove ? <>
        <Pressable accessibilityLabel={t('admin.crud.up')} disabled={i === 0} onPress={() => onMove(r, -1)} className={`w-8 h-8 items-center justify-center ${i === 0 ? 'opacity-25' : ''}`}><Icon name="arrow-up" size={18} /></Pressable>
        <Pressable accessibilityLabel={t('admin.crud.down')} disabled={i === rows.length - 1} onPress={() => onMove(r, 1)} className={`w-8 h-8 items-center justify-center ${i === rows.length - 1 ? 'opacity-25' : ''}`}><Icon name="arrow-down" size={18} /></Pressable>
      </> : null}
      {onToggle ? <Pressable testID={`toggle-${r.id}`} accessibilityLabel={t('admin.crud.showHide')} onPress={() => onToggle(r)} className="w-8 h-8 items-center justify-center"><Icon name={r.visible === false ? 'eye-off-outline' : 'eye-outline'} size={19} tone={r.visible === false ? 'muted' : 'fg'} /></Pressable> : null}
      {onEdit ? <Pressable testID={`edit-${r.id}`} accessibilityLabel={t('common.edit')} onPress={() => onEdit(r)} className="w-8 h-8 items-center justify-center"><Icon name="pencil-outline" size={19} /></Pressable> : null}
      {onDelete ? <Pressable testID={`del-${r.id}`} accessibilityLabel={t('common.delete')} onPress={() => onDelete(r)} className="w-8 h-8 items-center justify-center"><Icon name="trash-can-outline" size={19} tone="danger" /></Pressable> : null}
    </View>
  );
  return (
    <Card className="overflow-hidden">
      {desktop ? (
        <View className="flex-row items-center px-4 h-10 bg-surface2">
          {cols.map((c, i) => <Txt key={i} className="text-muted text-[12px] font-bold uppercase" style={{ flex: c.flex ?? 1 }}>{c.label}</Txt>)}
          <View style={{ width: 150 }} />
        </View>
      ) : null}
      {rows.map((r, i) => (
        <View key={r.id} testID={rowTestID ? `${rowTestID}-${r.id}` : undefined} className={`px-4 py-3 border-t border-line ${r.visible === false ? 'opacity-55' : ''}`}>
          {desktop ? (
            <View className="flex-row items-center">
              {cols.map((c, j) => <View key={j} style={{ flex: c.flex ?? 1 }} className="pe-3">{c.render(r)}</View>)}
              <View style={{ width: 150 }} className="items-end">{actions(r, i)}</View>
            </View>
          ) : (
            <View>
              <View className="flex-row items-center justify-between">
                <View className="flex-1 pe-2">{cols[0].render(r)}</View>
                {actions(r, i)}
              </View>
              {cols.slice(1).map((c, j) => (
                <View key={j} className="flex-row items-center mt-1.5 gap-2"><Txt className="text-muted text-[12px] w-24">{c.label}</Txt><View className="flex-1">{c.render(r)}</View></View>
              ))}
            </View>
          )}
        </View>
      ))}
    </Card>
  );
}
