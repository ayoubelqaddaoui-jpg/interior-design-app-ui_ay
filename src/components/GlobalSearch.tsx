import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Href, usePathname } from 'expo-router';
import { Button, Icon, Input, Sheet, Txt } from '@/components/ui';
import { ADMIN_NAV } from '@/components/admin/AdminShell';
import { requestLeave, router } from '@/hooks/useLeaveGuard';
import { useStore } from '@/store/useStore';
import { useLocal } from '@/store/useLocal';
import { useL, useT } from '@/i18n';

/** Root-level search is available from every route, independent of the active layout. */
export function GlobalSearch() {
  const path = usePathname();
  const session = useLocal((s) => s.adminSession);
  const admin = session && path.startsWith('/admin');
  const s = useStore();
  const L = useL();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const needle = query.trim().toLocaleLowerCase();
  type Result = { id: string; title: string; group: string; href: string; terms: string; icon: string };
  const results: Result[] = [];
  const add = (id: string, title: string, group: string, href: string, terms: unknown, icon: string) => {
    if (needle.length >= 2 && JSON.stringify(terms).toLocaleLowerCase().includes(needle)) results.push({ id, title, group, href, terms: '', icon });
  };
  if (admin) {
    for (const name of ['tools', 'styles', 'sections', 'categories', 'roomTypes', 'palettes', 'tabs'] as const) for (const item of s[name]) {
      add(item.id, L(item.title), t(`admin.nav.${name}`), `/admin/${name}`, [item.id, item.title], 'view-grid-outline');
    }
    for (const item of s.inspirations) add(item.id, L(s.categories.find((c) => c.id === item.categoryId)?.title) || item.id, t('admin.nav.inspirations'), '/admin/inspirations', [item.id, s.categories.find((c) => c.id === item.categoryId)?.title, s.styles.find((c) => c.id === item.styleId)?.title], 'image-outline');
    for (const item of s.models) add(item.id, item.name, t('admin.nav.models'), '/admin/models', [item.id, item.name, item.provider], 'robot-outline');
    for (const item of s.users) add(item.id, item.name || item.whatsapp, t('admin.nav.users'), '/admin/users', [item.id, item.name, item.whatsapp], 'account-outline');
    for (const item of s.requests) add(item.id, item.name, t('admin.nav.requests'), '/admin/requests', [item.id, item.name, item.whatsapp], 'inbox-outline');
    for (const item of ADMIN_NAV) add(`menu-${item.key}`, t(`admin.nav.${item.key}`), t('admin.title'), item.href, t(`admin.nav.${item.key}`), item.icon);
  } else {
    for (const item of s.tools.filter((x) => x.visible)) add(item.id, L(item.title), t('home.all'), '/', [item.id, item.title], 'toolbox-outline');
    for (const item of s.sections.filter((x) => x.visible)) add(item.id, L(item.title), t('tabs.explore'), '/explore', [item.id, item.title], 'view-carousel-outline');
    for (const item of s.categories.filter((x) => x.visible)) add(item.id, L(item.title), t('tabs.explore'), `/explore/section/${item.sectionId}`, [item.id, item.title], 'view-grid-outline');
    for (const item of s.inspirations.filter((x) => x.visible)) add(item.id, L(s.categories.find((c) => c.id === item.categoryId)?.title) || item.id, t('tabs.explore'), `/explore/category/${item.categoryId}`, [item.id, s.categories.find((c) => c.id === item.categoryId)?.title, s.styles.find((c) => c.id === item.styleId)?.title], 'image-outline');
  }
  const pick = (result: Result) => requestLeave(() => {
    setOpen(false);
    router.push(`${result.href}?target=${encodeURIComponent(result.id)}&focus=${Date.now()}` as Href);
  });
  return <>
    <View className="bg-bg border-b border-line px-3 py-1 flex-row justify-end">
      <Button testID="global-search-open" size="sm" icon="magnify" variant="ghost" title={t('common.search')} onPress={() => setOpen(true)} />
    </View>
    <Sheet visible={open} onClose={() => setOpen(false)} title={t('common.search')} wide>
      <Input testID="global-search-input" value={query} onChangeText={setQuery} autoFocus placeholder={t('admin.dash.searchPh')} />
      {needle.length >= 2 && !results.length ? <Txt className="text-muted p-3">{t('common.noResults')}</Txt> : null}
      {results.map((result) => <Pressable key={`${result.href}:${result.id}`} testID={`global-result-${result.id}`} accessibilityRole="link" onPress={() => pick(result)} className="flex-row gap-3 items-center px-3 py-2 border-b border-line">
        <Icon name={result.icon} size={20} /><View className="flex-1"><Txt className="font-semibold text-[14px]">{result.title}</Txt><Txt className="text-muted text-[12px]">{result.group}</Txt></View><Icon name="chevron-right" flip size={18} />
      </Pressable>)}
    </Sheet>
  </>;
}
