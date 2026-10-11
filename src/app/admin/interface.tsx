import React from 'react';
import { Pressable, View } from 'react-native';
import { Card, Icon, Txt } from '@/components/ui';
import { AdminPage } from '@/components/admin/AdminShell';
import { NavPreview } from '@/components/admin/NavPreview';
import { useBp } from '@/hooks/useBp';
import { useT } from '@/i18n';
import { useStore } from '@/store/useStore';
import { toast } from '@/store/useToast';
import type { AdminNavMode, UserNavStyle } from '@/data/types';

const USER: UserNavStyle[] = ['classic', 'floating', 'minimal'];
const ADMIN: AdminNavMode[] = ['rail', 'drawer', 'top'];

function Option({ id, active, title, desc, testID, onPress, children }: { id: string; active: boolean; title: string; desc: string; testID: string; onPress: () => void; children: React.ReactNode }) {
  const { t } = useT();
  return (
    <Pressable testID={testID} accessibilityRole="radio" accessibilityState={{ selected: active }} onPress={onPress} className={`flex-1 rounded-2xl border-2 p-3 ${active ? 'border-primary bg-soft' : 'border-line bg-surface'}`} style={{ minWidth: 200 }}>
      <View className="rounded-xl bg-surface2 overflow-hidden mb-3 items-center justify-center" style={{ height: 120 }}>{children}</View>
      <View className="flex-row items-center gap-2">
        <Txt className="font-extrabold text-[15px] flex-1">{title}</Txt>
        {active ? <View className="flex-row items-center gap-1 bg-primary rounded-full px-2 h-6"><Icon name="check" size={13} tone="onprimary" /><Txt className="text-onprimary text-[11px] font-bold">{t('admin.iface.current')}</Txt></View> : null}
      </View>
      <Txt className="text-muted text-[12px] mt-1">{desc}</Txt>
    </Pressable>
  );
}

export default function InterfaceAdmin() {
  const { t } = useT();
  const { tablet } = useBp();
  const settings = useStore((s) => s.doc.settings);
  const set = async (patch: Partial<typeof settings>) => { await useStore.getState().patchDoc('settings', patch); toast(t('admin.iface.applied')); };
  const wrap = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 12 };
  return (
    <AdminPage title={t('admin.iface.title')}>
      <Card className="p-4 mb-5">
        <Txt className="font-extrabold text-[17px]">{t('admin.iface.userNav')}</Txt>
        <Txt className="text-muted text-[13px] mb-4">{t('admin.iface.userNavDesc')}</Txt>
        <View style={wrap}>
          {USER.map((id) => (
            <Option key={id} id={id} testID={`usernav-${id}`} active={(settings.userNavStyle ?? 'floating') === id} title={t(`admin.iface.${id}`)} desc={t(`admin.iface.${id}Desc`)} onPress={() => set({ userNavStyle: id })}>
              <NavPreview kind="user" id={id} />
            </Option>
          ))}
        </View>
      </Card>
      <Card className="p-4">
        <Txt className="font-extrabold text-[17px]">{t('admin.iface.adminNav')}</Txt>
        <Txt className="text-muted text-[13px] mb-4">{t('admin.iface.adminNavDesc')}</Txt>
        <View style={wrap}>
          {ADMIN.map((id) => (
            <Option key={id} id={id} testID={`adminnav-${id}`} active={(settings.adminNavMode ?? 'drawer') === id} title={t(`admin.iface.${id}`)} desc={t(`admin.iface.${id}Desc`)} onPress={() => set({ adminNavMode: id })}>
              <NavPreview kind="admin" id={id} />
            </Option>
          ))}
        </View>
      </Card>
    </AdminPage>
  );
}
