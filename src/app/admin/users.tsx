import React from 'react';
import { Pressable, View } from 'react-native';
import { Input, Txt } from '@/components/ui';
import { AdminPage } from '@/components/admin/AdminShell';
import { CrudTable } from '@/components/admin/CrudTable';
import { useT } from '@/i18n';
import { useLocalSearchParams } from 'expo-router';
import { useViewState } from '@/hooks/useViewState';
import { useStore } from '@/store/useStore';

export default function Users() {
  const { t, lang } = useT();
  const { target } = useLocalSearchParams<{ target?: string }>();
  const [query, setQuery] = useViewState('user-search', '');
  const [role, setRole] = useViewState('user-role', 'all');
  const users = useStore((s) => s.users);
  const needle = query.trim().toLocaleLowerCase();
  const rows = users.filter((user) => user.id === target || (role === 'all' || user.role === role) && [user.name, user.whatsapp, user.id].join(' ').toLocaleLowerCase().includes(needle));
  const date = (n: number) => new Date(n).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'ar-MA');
  return (
    <AdminPage title={t('admin.nav.users')}>
      <View className="flex-row items-center gap-3 mb-1"><View className="flex-1"><Input testID="users-filter" value={query} onChangeText={setQuery} placeholder={t('common.search')} /></View><Txt className="text-muted text-[12px]">{rows.length} / {users.length}</Txt></View>
      <View className="flex-row flex-wrap gap-2 mb-3">{['all', 'user', 'admin'].map((key) => <Pressable key={key} testID={`users-role-${key}`} accessibilityRole="radio" accessibilityState={{ selected: role === key }} onPress={() => setRole(key)} className={`px-3 py-2 rounded-full ${role === key ? 'bg-primary' : 'bg-surface2'}`}><Txt className={`text-[12px] font-semibold ${role === key ? 'text-onprimary' : ''}`}>{t(key === 'all' ? 'improve.allRoles' : `admin.enums.${key}`)}</Txt></Pressable>)}</View>
      <CrudTable rows={rows} rowTestID="user" cols={[
        { label: t('admin.f.name'), flex: 1.5, render: (u) => <Txt className="font-bold" numberOfLines={1}>{u.name || '—'}</Txt> },
        { label: t('admin.f.whatsapp'), flex: 1.3, render: (u) => <Txt className="text-muted text-[13px]">{u.whatsapp || '—'}</Txt> },
        { label: t('admin.f.credits'), flex: 0.6, render: (u) => <Txt className="font-bold">{u.credits}</Txt> },
        { label: t('admin.f.role'), flex: 0.8, render: (u) => <View className={`self-start rounded-full px-2.5 py-0.5 ${u.role === 'admin' ? 'bg-primary' : 'bg-surface2'}`}><Txt className={`text-[12px] font-bold ${u.role === 'admin' ? 'text-onprimary' : ''}`}>{t(`admin.enums.${u.role}`)}</Txt></View> },
        { label: t('admin.f.date'), flex: 0.9, render: (u) => <Txt className="text-muted text-[13px]">{date(u.createdAt)}</Txt> },
      ]} />
    </AdminPage>
  );
}
