import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Href, usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, Txt } from '@/components/ui';
import { useBp } from '@/hooks/useBp';
import { useT } from '@/i18n';
import { useLocal } from '@/store/useLocal';
import { useStore } from '@/store/useStore';

export const ADMIN_NAV = [
  { key: 'dashboard', icon: 'view-dashboard-outline', href: '/admin' },
  { key: 'branding', icon: 'flag-outline', href: '/admin/branding' },
  { key: 'theme', icon: 'palette-outline', href: '/admin/theme' },
  { key: 'tabs', icon: 'tab', href: '/admin/tabs' },
  { key: 'tools', icon: 'toolbox-outline', href: '/admin/tools' },
  { key: 'sections', icon: 'view-carousel-outline', href: '/admin/sections' },
  { key: 'categories', icon: 'view-grid-outline', href: '/admin/categories' },
  { key: 'inspirations', icon: 'image-multiple-outline', href: '/admin/inspirations' },
  { key: 'styles', icon: 'palette-swatch-outline', href: '/admin/styles' },
  { key: 'roomTypes', icon: 'door-open', href: '/admin/roomTypes' },
  { key: 'palettes', icon: 'invert-colors', href: '/admin/palettes' },
  { key: 'models', icon: 'robot-outline', href: '/admin/models' },
  { key: 'assistant', icon: 'message-text-outline', href: '/admin/assistant' },
  { key: 'credits', icon: 'star-circle-outline', href: '/admin/credits' },
  { key: 'requests', icon: 'inbox-full-outline', href: '/admin/requests' },
  { key: 'users', icon: 'account-group-outline', href: '/admin/users' },
] as const;

function useActive() {
  const p = usePathname().replace(/\/$/, '');
  return (href: string) => (href === '/admin' ? p === '/admin' : p === href);
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { desktop } = useBp();
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const active = useActive();
  const name = useStore((s) => s.doc.branding.appName);
  const pending = useStore((s) => s.requests.filter((r) => r.status === 'pending').length);
  const logout = () => { useLocal.getState().set({ adminSession: false }); };

  const item = (n: (typeof ADMIN_NAV)[number], row = false) => {
    const on = active(n.href);
    return (
      <Pressable key={n.key} testID={`nav-${n.key}`} onPress={() => router.push(n.href as Href)}
        className={`flex-row items-center gap-3 rounded-xl ${row ? 'px-3.5 h-10 rounded-full' : 'px-3 h-11'} ${on ? 'bg-primary' : row ? 'bg-surface2' : 'active:bg-surface2'}`}>
        <Icon name={n.icon} size={20} tone={on ? 'onprimary' : 'fg'} />
        <Txt className={`font-semibold text-[14px] ${on ? 'text-onprimary' : ''}`}>{t(`admin.nav.${n.key}`)}</Txt>
        {n.key === 'requests' && pending > 0 ? <View className="bg-danger rounded-full min-w-[20px] h-5 px-1.5 items-center justify-center"><Txt className="text-white text-[11px] font-bold">{pending}</Txt></View> : null}
      </Pressable>
    );
  };

  if (desktop) {
    return (
      <View className="flex-1 flex-row bg-bg">
        <View className="w-[260px] bg-surface border-e border-line" style={{ paddingTop: insets.top }}>
          <View className="px-5 py-5 flex-row items-center gap-2">
            <View className="w-9 h-9 rounded-xl bg-primary items-center justify-center"><Icon name="cog-outline" size={20} tone="onprimary" /></View>
            <View><Txt className="font-extrabold text-[16px]">{name}</Txt><Txt className="text-muted text-[12px]">{t('admin.title')}</Txt></View>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 12, gap: 2, paddingBottom: 12 }}>{ADMIN_NAV.map((n) => item(n))}</ScrollView>
          <View className="p-3 border-t border-line gap-1">
            <Pressable testID="open-app" onPress={() => router.replace('/')} className="flex-row items-center gap-3 px-3 h-10"><Icon name="open-in-new" size={19} /><Txt className="font-semibold text-[14px]">{t('admin.openApp')}</Txt></Pressable>
            <Pressable testID="logout" onPress={logout} className="flex-row items-center gap-3 px-3 h-10"><Icon name="logout" size={19} tone="danger" /><Txt className="font-semibold text-[14px] text-danger">{t('admin.logout')}</Txt></Pressable>
          </View>
        </View>
        <View className="flex-1">{children}</View>
      </View>
    );
  }
  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-4 h-12">
        <Txt className="font-extrabold text-[17px]">{name} · {t('admin.title')}</Txt>
        <View className="flex-row gap-1">
          <Pressable onPress={() => router.replace('/')} className="w-10 h-10 items-center justify-center" accessibilityLabel={t('admin.openApp')}><Icon name="open-in-new" size={21} /></Pressable>
          <Pressable onPress={logout} className="w-10 h-10 items-center justify-center" accessibilityLabel={t('admin.logout')}><Icon name="logout" size={21} tone="danger" /></Pressable>
        </View>
      </View>
      <View style={{ height: 52 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 8, alignItems: 'center' }}>{ADMIN_NAV.map((n) => item(n, true))}</ScrollView>
      </View>
      <View className="flex-1">{children}</View>
    </View>
  );
}

/** Standard admin page: title row + scrollable, width-limited body. */
export function AdminPage({ title, right, children, max = 1100 }: { title: string; right?: React.ReactNode; children: React.ReactNode; max?: number }) {
  const { tablet } = useBp();
  return (
    <ScrollView contentContainerStyle={{ padding: tablet ? 28 : 16, paddingBottom: 60 }}>
      <View style={{ width: '100%', maxWidth: max, alignSelf: 'center' }}>
        <View className="flex-row items-center justify-between mb-5 gap-3">
          <Txt className="text-[24px] font-extrabold flex-1" accessibilityRole="header">{title}</Txt>
          {right}
        </View>
        {children}
      </View>
    </ScrollView>
  );
}
