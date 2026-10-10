import React from 'react';
import { View } from 'react-native';
import { MediaView, Icon, Txt } from '@/components/ui';
import type { FieldDef, Ctx, Opt } from '@/components/admin/FormModal';
import type { Col } from '@/components/admin/CrudTable';
import type { CollMap, CollName, LText } from '@/data/types';
import { nextOrder, sorted } from '@/store/useStore';

export interface EntityConfig<K extends CollName = CollName> {
  name: K;
  navKey: string;
  icon: string;
  ordered: boolean;
  fields(c: Ctx): FieldDef[];
  cols(c: Ctx): Col<CollMap[K]>[];
  blank(c: Ctx): Omit<CollMap[K], 'id'>;
  /** Collections whose rows are deleted with the parent: [collection, foreign key]. */
  cascade?: [CollName, string][];
}

const lt = (): LText => ({ dar: '', ar: '', fr: '' });
const o = (c: Ctx, name: CollName) => nextOrder(c.s[name] as { order: number }[]);
const opts = <T extends { id: string; title: LText }>(c: Ctx, list: T[]): Opt[] => sorted(list as any).map((x: any) => ({ value: x.id, label: c.L(x.title) }));
const common = (c: Ctx): FieldDef[] => [{ kind: 'bool', key: 'visible', label: c.t('admin.f.visible') }];
const titleCol = (c: Ctx): Col<any> => ({ label: c.t('admin.f.title'), flex: 2, render: (r) => <Txt className="font-bold" numberOfLines={1}>{c.L(r.title)}</Txt> });
const thumb = (label: string, get: (r: any) => string | undefined, round = false): Col<any> => ({ label, flex: 0.7, render: (r) => <MediaView uri={get(r)} className={round ? 'rounded-full' : 'rounded-lg'} style={{ width: 44, height: 44 }} /> });
const txt = (label: string, get: (r: any) => string, flex = 1): Col<any> => ({ label, flex, render: (r) => <Txt className="text-muted text-[13px]" numberOfLines={1}>{get(r)}</Txt> });
const stepOpts = (c: Ctx): Opt[] => (['room', 'style', 'mode', 'model'] as const).map((k) => ({ value: k, label: c.t(`admin.enums.${k}`) }));

const tabs: EntityConfig<'tabs'> = {
  name: 'tabs', navKey: 'tabs', icon: 'tab', ordered: true,
  fields: (c) => [{ kind: 'ltext', key: 'title', label: c.t('admin.f.title') }, ...common(c)],
  cols: (c) => [titleCol(c)],
  blank: () => ({ title: lt(), order: 0, visible: true }),
  cascade: [['tools', 'tabId']],
};

const tools: EntityConfig<'tools'> = {
  name: 'tools', navKey: 'tools', icon: 'toolbox-outline', ordered: true,
  fields: (c) => [
    { kind: 'ltext', key: 'title', label: c.t('admin.f.title') },
    { kind: 'ltext', key: 'subtitle', label: c.t('admin.f.subtitle') },
    { kind: 'media', key: 'media', label: c.t('admin.f.media') },
    { kind: 'select', key: 'tabId', label: c.t('admin.f.tab'), required: true, options: (x) => opts(x, x.s.tabs) },
    { kind: 'select', key: 'roomGroup', label: c.t('admin.f.group'), options: (x) => [{ value: 'interior', label: x.t('admin.enums.interior') }, { value: 'exterior', label: x.t('admin.enums.exterior') }] },
    { kind: 'multi', key: 'steps', label: c.t('admin.f.steps'), options: stepOpts },
    { kind: 'multi', key: 'modelIds', label: c.t('admin.f.models'), options: (x) => x.s.models.map((m) => ({ value: m.id, label: m.name })) },
    ...common(c),
  ],
  cols: (c) => [
    thumb(c.t('admin.f.media'), (r) => r.media.type === 'video' ? r.media.poster : r.media.uri),
    titleCol(c),
    txt(c.t('admin.f.tab'), (r) => c.L(c.s.tabs.find((x) => x.id === r.tabId)?.title)),
    txt(c.t('admin.f.steps'), (r) => r.steps.map((k: string) => c.t(`admin.enums.${k}`)).join(' · '), 1.5),
    txt(c.t('admin.f.mediaType'), (r) => c.t(`admin.enums.${r.media.type}`), 0.6),
  ],
  blank: (c) => ({ tabId: sorted(c.s.tabs)[0]?.id ?? '', title: lt(), subtitle: lt(), media: { type: 'image', uri: '' }, steps: ['room', 'style'], modelIds: c.s.models.filter((m) => m.enabled).map((m) => m.id), roomGroup: 'interior', order: o(c, 'tools'), visible: true }),
};

const sections: EntityConfig<'sections'> = {
  name: 'sections', navKey: 'sections', icon: 'view-carousel-outline', ordered: true,
  fields: (c) => [
    { kind: 'ltext', key: 'title', label: c.t('admin.f.title') },
    { kind: 'icon', key: 'icon', label: c.t('admin.f.icon') },
    { kind: 'select', key: 'toolId', label: c.t('admin.f.tool'), required: true, options: (x) => opts(x, x.s.tools) },
    ...common(c),
  ],
  cols: (c) => [titleCol(c), { label: c.t('admin.f.icon'), flex: 0.5, render: (r) => <Icon name={r.icon} size={22} /> }, txt(c.t('admin.f.tool'), (r) => c.L(c.s.tools.find((x) => x.id === r.toolId)?.title))],
  blank: (c) => ({ title: lt(), icon: 'sofa-outline', toolId: sorted(c.s.tools)[0]?.id ?? '', order: o(c, 'sections'), visible: true }),
  cascade: [['categories', 'sectionId']],
};

const categories: EntityConfig<'categories'> = {
  name: 'categories', navKey: 'categories', icon: 'view-grid-outline', ordered: true,
  fields: (c) => [
    { kind: 'ltext', key: 'title', label: c.t('admin.f.title') },
    { kind: 'image', key: 'cover', label: c.t('admin.f.cover') },
    { kind: 'select', key: 'sectionId', label: c.t('admin.f.section'), required: true, options: (x) => opts(x, x.s.sections) },
    { kind: 'select', key: 'roomTypeId', label: c.t('admin.f.roomType'), options: (x) => opts(x, x.s.roomTypes) },
    ...common(c),
  ],
  cols: (c) => [thumb(c.t('admin.f.cover'), (r) => r.cover), titleCol(c), txt(c.t('admin.f.section'), (r) => c.L(c.s.sections.find((x) => x.id === r.sectionId)?.title))],
  blank: (c) => ({ title: lt(), cover: '', sectionId: sorted(c.s.sections)[0]?.id ?? '', order: o(c, 'categories'), visible: true }),
  cascade: [['inspirations', 'categoryId']],
};

const inspirations: EntityConfig<'inspirations'> = {
  name: 'inspirations', navKey: 'inspirations', icon: 'image-multiple-outline', ordered: true,
  fields: (c) => [
    { kind: 'image', key: 'image', label: c.t('admin.f.photo') },
    { kind: 'select', key: 'categoryId', label: c.t('admin.f.category'), required: true, options: (x) => opts(x, x.s.categories) },
    { kind: 'select', key: 'styleId', label: c.t('admin.f.style'), options: (x) => opts(x, x.s.styles) },
    ...common(c),
  ],
  cols: (c) => [
    thumb(c.t('admin.f.photo'), (r) => r.image),
    txt(c.t('admin.f.category'), (r) => c.L(c.s.categories.find((x) => x.id === r.categoryId)?.title), 2),
    txt(c.t('admin.f.style'), (r) => c.L(c.s.styles.find((x) => x.id === r.styleId)?.title)),
  ],
  blank: (c) => ({ image: '', categoryId: sorted(c.s.categories)[0]?.id ?? '', order: o(c, 'inspirations'), visible: true }),
};

const styles: EntityConfig<'styles'> = {
  name: 'styles', navKey: 'styles', icon: 'palette-swatch-outline', ordered: true,
  fields: (c) => [{ kind: 'ltext', key: 'title', label: c.t('admin.f.title') }, { kind: 'image', key: 'image', label: c.t('admin.f.photo') }, ...common(c)],
  cols: (c) => [thumb(c.t('admin.f.photo'), (r) => r.image, true), titleCol(c)],
  blank: (c) => ({ title: lt(), image: '', order: o(c, 'styles'), visible: true }),
};

const roomTypes: EntityConfig<'roomTypes'> = {
  name: 'roomTypes', navKey: 'roomTypes', icon: 'door-open', ordered: true,
  fields: (c) => [
    { kind: 'ltext', key: 'title', label: c.t('admin.f.title') },
    { kind: 'select', key: 'group', label: c.t('admin.f.group'), options: (x) => [{ value: 'interior', label: x.t('admin.enums.interior') }, { value: 'exterior', label: x.t('admin.enums.exterior') }] },
    { kind: 'select', key: 'displayMode', label: c.t('admin.f.displayMode'), options: (x) => [{ value: 'icon', label: x.t('admin.enums.icon') }, { value: 'image', label: x.t('admin.enums.image') }] },
    { kind: 'icon', key: 'icon', label: c.t('admin.f.icon'), show: (v) => v.displayMode === 'icon' },
    { kind: 'image', key: 'image', label: c.t('admin.f.photo'), show: (v) => v.displayMode === 'image' },
    { kind: 'bool', key: 'isNew', label: c.t('admin.f.isNew') },
    ...common(c),
  ],
  cols: (c) => [
    { label: c.t('admin.f.icon'), flex: 0.6, render: (r) => r.displayMode === 'image' ? <MediaView uri={r.image} className="rounded-lg" style={{ width: 44, height: 44 }} /> : <View className="w-11 h-11 rounded-lg bg-surface2 items-center justify-center"><Icon name={r.icon} size={24} /></View> },
    titleCol(c),
    txt(c.t('admin.f.group'), (r) => c.t(`admin.enums.${r.group}`)),
    txt(c.t('admin.f.displayMode'), (r) => c.t(`admin.enums.${r.displayMode}`), 0.7),
    txt(c.t('admin.f.isNew'), (r) => (r.isNew ? '★' : ''), 0.4),
  ],
  blank: (c) => ({ title: lt(), group: 'interior', displayMode: 'icon', icon: 'sofa-outline', image: '', isNew: false, order: o(c, 'roomTypes'), visible: true }),
};

const palettes: EntityConfig<'palettes'> = {
  name: 'palettes', navKey: 'palettes', icon: 'palette-outline', ordered: true,
  fields: (c) => [
    { kind: 'ltext', key: 'title', label: c.t('admin.f.title') },
    { kind: 'colors', key: 'colors', label: c.t('admin.f.colors'), show: (v) => !v.isSurprise },
    { kind: 'bool', key: 'isSurprise', label: c.t('admin.f.isSurprise') },
    ...common(c),
  ],
  cols: (c) => [
    titleCol(c),
    { label: c.t('admin.f.colors'), flex: 2, render: (r) => r.isSurprise ? <Icon name="shimmer" size={20} /> : <View className="flex-row gap-1">{r.colors.map((x: string, i: number) => <View key={i} style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: x, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' }} />)}</View> },
  ],
  blank: (c) => ({ title: lt(), colors: ['#F5F0E6', '#C9B79C', '#8A6F4D'], isSurprise: false, order: o(c, 'palettes'), visible: true }),
};

const models: EntityConfig<'models'> = {
  name: 'models', navKey: 'models', icon: 'robot-outline', ordered: true,
  fields: (c) => [
    { kind: 'text', key: 'name', label: c.t('admin.f.name'), required: true },
    { kind: 'text', key: 'provider', label: c.t('admin.f.provider'), required: true },
    { kind: 'text', key: 'modelName', label: c.t('admin.f.modelName'), required: true },
    { kind: 'secret', key: 'apiKey', label: c.t('admin.f.apiKey') },
    { kind: 'bool', key: 'enabled', label: c.t('admin.f.enabled') },
    { kind: 'bool', key: 'isDefault', label: c.t('admin.f.isDefault') },
    ...common(c),
  ],
  cols: (c) => [
    { label: c.t('admin.f.name'), flex: 1.4, render: (r) => <Txt className="font-bold" numberOfLines={1}>{r.name}</Txt> },
    txt(c.t('admin.f.provider'), (r) => r.provider, 0.8),
    txt(c.t('admin.f.modelName'), (r) => r.modelName, 1.3),
    txt(c.t('admin.f.apiKey'), (r) => (r.apiKey ? '••••' + String(r.apiKey).slice(-4) : '—'), 0.8),
    { label: c.t('admin.f.enabled'), flex: 0.9, render: (r) => <View className="flex-row items-center gap-1.5"><Icon name={r.enabled ? 'check-circle' : 'close-circle-outline'} size={18} tone={r.enabled ? 'success' : 'muted'} />{r.isDefault ? <Icon name="star" size={18} /> : null}</View> },
  ],
  blank: (c) => ({ name: '', provider: '', modelName: '', apiKey: '', enabled: true, isDefault: false, order: o(c, 'models'), visible: true }),
};

export const ENTITIES = { tabs, tools, sections, categories, inspirations, styles, roomTypes, palettes, models } as unknown as Record<string, EntityConfig<any>>;
export const NAV_ENTITIES = Object.values(ENTITIES);
