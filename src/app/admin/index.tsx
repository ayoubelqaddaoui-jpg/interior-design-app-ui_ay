import React from 'react';
import { Pressable, View } from 'react-native';
import { Href, useRouter } from 'expo-router';
import { Card, Icon, Txt } from '@/components/ui';
import { AdminPage } from '@/components/admin/AdminShell';
import { useBp } from '@/hooks/useBp';
import { useT } from '@/i18n';
import { useStore } from '@/store/useStore';

export default function Dashboard() {
  const { t } = useT();
  const { pick } = useBp();
  const router = useRouter();
  const s = useStore();
  const stats = [
    { k: 'requests', v: s.requests.length, icon: 'inbox-full-outline', href: '/admin/requests' },
    { k: 'pending', v: s.requests.filter((r) => r.status === 'pending').length, icon: 'clock-outline', href: '/admin/requests' },
    { k: 'users', v: s.users.filter((u) => u.role === 'user').length, icon: 'account-group-outline', href: '/admin/users' },
    { k: 'tools', v: s.tools.length, icon: 'toolbox-outline', href: '/admin/tools' },
  ];
  const cols = pick(2, 4, 4);
  return (
    <AdminPage title={t('admin.welcome')}>
      <View className="flex-row flex-wrap" style={{ marginHorizontal: -6 }}>
        {stats.map((x) => (
          <View key={x.k} style={{ width: `${100 / cols}%`, padding: 6 }}>
            <Pressable testID={`stat-${x.k}`} onPress={() => router.push(x.href as Href)}>
              <Card className="p-4">
                <View className="w-10 h-10 rounded-xl bg-soft items-center justify-center mb-3"><Icon name={x.icon} size={22} /></View>
                <Txt className="text-[30px] font-extrabold">{x.v}</Txt>
                <Txt className="text-muted text-[13px] font-semibold">{t(`admin.stats.${x.k}`)}</Txt>
              </Card>
            </Pressable>
          </View>
        ))}
      </View>
    </AdminPage>
  );
}
