import React, { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Button, Card, EmptyState, Icon, MediaView, Txt } from '@/components/ui';
import { useBp } from '@/hooks/useBp';
import { SearchTarget, useViewState } from '@/hooks/useViewState';
import { useT } from '@/i18n';

export type Col<T> = { label: string; flex?: number; render: (item: T) => React.ReactNode };

/** Table on desktop, stacked cards on mobile. Same data/props. */
export function CrudTable<T extends { id: string; visible?: boolean }>({ rows, cols, onEdit, onDelete, onMove, onToggle, rowTestID, selected, onSelect, onLongPress, visual = false }: {
  visual?: boolean; rows: T[]; cols: Col<T>[]; onEdit?: (r: T) => void; onDelete?: (r: T) => void; onMove?: (r: T, d: -1 | 1) => void; onToggle?: (r: T) => void; rowTestID?: string; selected?: string[]; onSelect?: (id: string) => void; onLongPress?: (id: string) => void;
}) {
  const { desktop } = useBp();
  const { t } = useT();
  const { target, focus } = useLocalSearchParams<{ target?: string; focus?: string }>();
  const [width, setWidth] = useState(0);
  const [page, setPage] = useViewState('table-page', 0);
  const pageSize = 24;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(pageCount - 1, Math.max(0, page));
  const targetIndex = rows.findIndex((row) => row.id === target);
  useEffect(() => {
    if (targetIndex < 0) return;
    const timer = setTimeout(() => setPage(Math.floor(targetIndex / pageSize)), 0);
    return () => clearTimeout(timer);
  }, [targetIndex, target, focus, setPage]);
  const visibleRows = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const measure = (event: import('react-native').LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  const pagination = pageCount > 1 ? <View testID="crud-pagination" className="flex-row flex-wrap items-center justify-between gap-2 py-2"><Button testID="page-previous" size="sm" variant="soft" icon="chevron-left" title={t('improve.previous')} disabled={currentPage === 0} onPress={() => setPage(currentPage - 1)} /><Txt testID="page-count" className="text-muted text-[12px]">{t('improve.pageCount', { page: currentPage + 1, count: pageCount })}</Txt><Button testID="page-next" size="sm" variant="soft" icon="chevron-right" title={t('improve.next')} disabled={currentPage === pageCount - 1} onPress={() => setPage(currentPage + 1)} /></View> : null;
  const [expanded, setExpanded] = useViewState<string[]>('expanded-rows', []);
  if (!rows.length) return <EmptyState icon="database-off-outline" title={t('admin.crud.noItems')} />;
  const checkbox = (r: T) => onSelect ? <Pressable testID={`select-${r.id}`} accessibilityRole="checkbox" aria-checked={selected?.includes(r.id) ?? false} accessibilityState={{ checked: selected?.includes(r.id) ?? false }} accessibilityLabel={t('common.select')} onPress={(event) => { event.stopPropagation(); onSelect(r.id); }} className="w-10 h-10 items-center justify-center"><Icon name={selected?.includes(r.id) ? 'checkbox-marked' : 'checkbox-blank-outline'} size={22} tone={selected?.includes(r.id) ? 'primary' : 'muted'} /></Pressable> : null;
  const actions = (r: T, i: number) => (
    <View className="flex-row items-center gap-1" style={{ flexShrink: 0 }}>
      {onMove ? <>
        <Pressable accessibilityLabel={t('admin.crud.up')} disabled={i === 0} onPress={(event) => { event.stopPropagation(); onMove(r, -1); }} className={`w-8 h-8 items-center justify-center ${i === 0 ? 'opacity-25' : ''}`}><Icon name="arrow-up" size={18} /></Pressable>
        <Pressable accessibilityLabel={t('admin.crud.down')} disabled={i === rows.length - 1} onPress={(event) => { event.stopPropagation(); onMove(r, 1); }} className={`w-8 h-8 items-center justify-center ${i === rows.length - 1 ? 'opacity-25' : ''}`}><Icon name="arrow-down" size={18} /></Pressable>
      </> : null}
      {onToggle ? <Pressable testID={`toggle-${r.id}`} accessibilityLabel={t('admin.crud.showHide')} onPress={(event) => { event.stopPropagation(); onToggle(r); }} hitSlop={6} className="w-9 h-9 items-center justify-center"><Icon name={r.visible === false ? 'eye-off-outline' : 'eye-outline'} size={19} tone={r.visible === false ? 'muted' : 'fg'} /></Pressable> : null}
      {onEdit ? <Pressable testID={`edit-${r.id}`} accessibilityLabel={t('common.edit')} onPress={(event) => { event.stopPropagation(); onEdit(r); }} hitSlop={6} className="w-9 h-9 items-center justify-center"><Icon name="pencil-outline" size={19} /></Pressable> : null}
      {onDelete ? <Pressable testID={`del-${r.id}`} accessibilityLabel={t('common.delete')} onPress={(event) => { event.stopPropagation(); onDelete(r); }} hitSlop={6} className="w-9 h-9 items-center justify-center"><Icon name="trash-can-outline" size={19} tone="danger" /></Pressable> : null}
    </View>
  );
  if (visual) return <View onLayout={measure}><View testID="crud-visual-grid" style={{ flexDirection: 'row', flexWrap: 'wrap', margin: -4 }}>
    {visibleRows.map((r, i) => <View key={r.id} style={{ width: width >= 900 ? '25%' : width >= 640 ? '33.333%' : width >= 340 ? '50%' : '100%', padding: 4, minWidth: 0 }}>
      <SearchTarget id={r.id}><Card className={`overflow-hidden ${selected?.includes(r.id) ? 'border-primary bg-soft' : ''}`}>
        <Pressable testID={rowTestID ? `${rowTestID}-${r.id}` : undefined} delayLongPress={450} onLongPress={onLongPress ? () => onLongPress(r.id) : undefined} onPress={() => selected?.length && onSelect ? onSelect(r.id) : onEdit?.(r)}>
          <MediaView uri={(r as any).image || (r as any).cover} style={{ height: desktop ? 130 : 108, opacity: r.visible === false ? 0.5 : 1 }} />
          <View className="p-2 gap-1">{cols.slice(1).map((c, j) => <View key={j}>{c.render(r)}</View>)}</View>
        </Pressable>
        <View className="flex-row flex-wrap items-center justify-between px-1 pb-1">{checkbox(r)}{actions(r, currentPage * pageSize + i)}</View>
      </Card></SearchTarget>
    </View>)}
  </View>{pagination}</View>;
  return (
    <View onLayout={measure}>
    <Card className="overflow-hidden">
      {desktop ? (
        <View className="flex-row items-center px-4 h-10 bg-surface2">
          {onSelect ? <View style={{ width: 40 }} /> : null}
          {cols.map((c, i) => <Txt key={i} className="text-muted text-[12px] font-bold uppercase" style={{ flex: c.flex ?? 1, minWidth: 0 }}>{c.label}</Txt>)}
          <View style={{ width: onEdit || onDelete || onToggle || onMove ? 192 : 0 }} />
        </View>
      ) : null}
      {visibleRows.map((r, i) => (
        <SearchTarget key={r.id} id={r.id}><Pressable accessibilityRole={onSelect ? 'button' : undefined} accessibilityLabel={onSelect ? t('improve.holdSelect') : undefined} delayLongPress={450} onLongPress={onLongPress ? () => onLongPress(r.id) : undefined} onPress={onSelect && selected?.length ? () => onSelect(r.id) : !desktop ? () => setExpanded((old) => old.includes(r.id) ? old.filter((id) => id !== r.id) : [...old, r.id]) : undefined} testID={rowTestID ? `${rowTestID}-${r.id}` : undefined} className={`px-3 py-2 border-t ${selected?.includes(r.id) ? 'border-primary' : 'border-line'} ${r.visible === false ? 'opacity-55' : ''} ${selected?.includes(r.id) ? 'bg-soft' : ''}`} style={{ borderWidth: selected?.includes(r.id) ? 2 : undefined }}>
          {desktop ? (
            <View className="flex-row items-center">
              {checkbox(r)}
              {cols.map((c, j) => <View key={j} style={{ flex: c.flex ?? 1, minWidth: 0 }} className="pe-3">{c.render(r)}</View>)}
              <View style={{ width: onEdit || onDelete || onToggle || onMove ? 192 : 0 }} className="items-end">{actions(r, currentPage * pageSize + i)}</View>
            </View>
          ) : (
            <View>
              <View className="flex-row items-center">
                {checkbox(r)}
                <View className="flex-1 pe-2">{cols[0].render(r)}</View>

              </View>
              <View className="flex-row items-center justify-between mt-1"><Icon name={expanded.includes(r.id) ? 'chevron-up' : 'chevron-down'} size={17} tone="muted" />{actions(r, currentPage * pageSize + i)}</View>
              {(expanded.includes(r.id) ? cols.slice(1) : cols.slice(1, 2)).map((c, j) => (
                <View key={j} className="flex-row items-start mt-1 gap-2"><Txt className="text-muted text-[12px] leading-[20px] w-24">{c.label}</Txt><View className="flex-1">{c.render(r)}</View></View>
              ))}
            </View>
          )}
        </Pressable></SearchTarget>
      ))}
    </Card>{pagination}</View>
  );
}
