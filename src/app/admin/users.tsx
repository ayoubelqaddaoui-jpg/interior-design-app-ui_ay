import React from 'react';
import { View } from 'react-native';
import { Txt } from '@/components/ui';
import { AdminPage } from '@/components/admin/AdminShell';
import { CrudTable } from '@/components/admin/CrudTable';
import { useT } from '@/i18n';
import { useStore } from '@/store/useStore';

export default function Users() {
  const { t } = useT();
  const users = useStore((s) => s.users);
  const date = (n: number) => new Date(n).toLocaleDateString();
  return (
    <AdminPage title={t('admin.nav.users')}>
      <CrudTable rows={users} rowTestID="user" cols={[
        { label: t('admin.f.name'), flex: 1.5, render: (u) => <Txt className="font-bold" numberOfLines={1}>{u.name || '—'}</Txt> },
        { label: t('admin.f.whatsapp'), flex: 1.3, render: (u) => <Txt className="text-muted text-[13px]">{u.whatsapp || '—'}</Txt> },
        { label: t('admin.f.credits'), flex: 0.6, render: (u) => <Txt className="font-bold">{u.credits}</Txt> },
        { label: t('admin.f.role'), flex: 0.8, render: (u) => <View className={`self-start rounded-full px-2.5 py-0.5 ${u.role === 'admin' ? 'bg-primary' : 'bg-surface2'}`}><Txt className={`text-[12px] font-bold ${u.role === 'admin' ? 'text-onprimary' : ''}`}>{t(`admin.enums.${u.role}`)}</Txt></View> },
        { label: t('admin.f.date'), flex: 0.9, render: (u) => <Txt className="text-muted text-[13px]">{date(u.createdAt)}</Txt> },
      ]} />
    </AdminPage>
  );
}
