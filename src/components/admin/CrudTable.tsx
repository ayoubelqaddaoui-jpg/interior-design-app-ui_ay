import React from 'react';
import { Pressable, View } from 'react-native';
import { Card, EmptyState, Icon, Txt } from '@/components/ui';
import { useBp } from '@/hooks/useBp';
import { useT } from '@/i18n';

export type Col<T> = { label: string; flex?: number; render: (item: T) => React.ReactNode };

/** Table on desktop, stacked cards on mobile. Same data/props. */
export function CrudTable<T extends { id: string; visible?: boolean }>({ rows, cols, onEdit, onDelete, onMove, onToggle, rowTestID, selected, onSelect, onLongPress }: {
  rows: T[]; cols: Col<T>[]; onEdit?: (r: T) => void; onDelete?: (r: T) => void; onMove?: (r: T, d: -1 | 1) => void; onToggle?: (r: T) => void; rowTestID?: string; selected?: string[]; onSelect?: (id: string) => void; onLongPress?: (id: string) => void;
}) {
  const { desktop } = useBp();
  const { t } = useT();
  if (!rows.length) return <EmptyState icon="database-off-outline" title={t('admin.crud.noItems')} />;
  const checkbox = (r: T) => onSelect ? <Pressable testID={`select-${r.id}`} accessibilityRole="checkbox" aria-checked={selected?.includes(r.id) ?? false} accessibilityState={{ checked: selected?.includes(r.id) ?? false }} accessibilityLabel={t('common.select')} onPress={(event) => { event.stopPropagation(); onSelect(r.id); }} className="w-10 h-10 items-center justify-center"><Icon name={selected?.includes(r.id) ? 'checkbox-marked' : 'checkbox-blank-outline'} size={22} tone={selected?.includes(r.id) ? 'primary' : 'muted'} /></Pressable> : null;
  const actions = (r: T, i: number) => (
    <View className="flex-row items-center gap-1">
      {onMove ? <>
        <Pressable accessibilityLabel={t('admin.crud.up')} disabled={i === 0} onPress={(event) => { event.stopPropagation(); onMove(r, -1); }} className={`w-8 h-8 items-center justify-center ${i === 0 ? 'opacity-25' : ''}`}><Icon name="arrow-up" size={18} /></Pressable>
        <Pressable accessibilityLabel={t('admin.crud.down')} disabled={i === rows.length - 1} onPress={(event) => { event.stopPropagation(); onMove(r, 1); }} className={`w-8 h-8 items-center justify-center ${i === rows.length - 1 ? 'opacity-25' : ''}`}><Icon name="arrow-down" size={18} /></Pressable>
      </> : null}
      {onToggle ? <Pressable testID={`toggle-${r.id}`} accessibilityLabel={t('admin.crud.showHide')} onPress={(event) => { event.stopPropagation(); onToggle(r); }} className="w-8 h-8 items-center justify-center"><Icon name={r.visible === false ? 'eye-off-outline' : 'eye-outline'} size={19} tone={r.visible === false ? 'muted' : 'fg'} /></Pressable> : null}
      {onEdit ? <Pressable testID={`edit-${r.id}`} accessibilityLabel={t('common.edit')} onPress={(event) => { event.stopPropagation(); onEdit(r); }} className="w-8 h-8 items-center justify-center"><Icon name="pencil-outline" size={19} /></Pressable> : null}
      {onDelete ? <Pressable testID={`del-${r.id}`} accessibilityLabel={t('common.delete')} onPress={(event) => { event.stopPropagation(); onDelete(r); }} className="w-8 h-8 items-center justify-center"><Icon name="trash-can-outline" size={19} tone="danger" /></Pressable> : null}
    </View>
  );
  return (
    <Card className="overflow-hidden">
      {desktop ? (
        <View className="flex-row items-center px-4 h-10 bg-surface2">
          {onSelect ? <View style={{ width: 40 }} /> : null}
          {cols.map((c, i) => <Txt key={i} className="text-muted text-[12px] font-bold uppercase" style={{ flex: c.flex ?? 1 }}>{c.label}</Txt>)}
          <View style={{ width: 150 }} />
        </View>
      ) : null}
      {rows.map((r, i) => (
        <Pressable key={r.id} accessibilityRole={onSelect ? 'button' : undefined} accessibilityLabel={onSelect ? t('improve.holdSelect') : undefined} delayLongPress={450} onLongPress={onLongPress ? () => onLongPress(r.id) : undefined} onPress={onSelect && selected?.length ? () => onSelect(r.id) : undefined} testID={rowTestID ? `${rowTestID}-${r.id}` : undefined} className={`px-4 py-3 border-t ${selected?.includes(r.id) ? 'border-primary' : 'border-line'} ${r.visible === false ? 'opacity-55' : ''} ${selected?.includes(r.id) ? 'bg-soft' : ''}`} style={{ borderWidth: selected?.includes(r.id) ? 2 : undefined }}>
          {desktop ? (
            <View className="flex-row items-center">
              {checkbox(r)}
              {cols.map((c, j) => <View key={j} style={{ flex: c.flex ?? 1 }} className="pe-3">{c.render(r)}</View>)}
              <View style={{ width: 150 }} className="items-end">{actions(r, i)}</View>
            </View>
          ) : (
            <View>
              <View className="flex-row items-center">
                {checkbox(r)}
                <View className="flex-1 pe-2">{cols[0].render(r)}</View>

              </View>
              <View className="self-end mt-2">{actions(r, i)}</View>
              {cols.slice(1).map((c, j) => (
                <View key={j} className="flex-row items-start mt-3 gap-3"><Txt className="text-muted text-[12px] leading-[20px] w-24">{c.label}</Txt><View className="flex-1">{c.render(r)}</View></View>
              ))}
            </View>
          )}
        </Pressable>
      ))}
    </Card>
  );
}
