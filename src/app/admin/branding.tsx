import React, { useState } from 'react';
import { Button, Card, Input, Txt } from '@/components/ui';
import { AdminPage } from '@/components/admin/AdminShell';
import { ImageField } from '@/components/admin/ImageField';
import { useT } from '@/i18n';
import { useStore } from '@/store/useStore';
import { toast } from '@/store/useToast';

export default function Branding() {
  const { t } = useT();
  const b = useStore((s) => s.doc.branding);
  const [name, setName] = useState(b.appName);
  const [logo, setLogo] = useState(b.logoUri);
  const save = async () => { await useStore.getState().patchDoc('branding', { appName: name.trim() || b.appName, logoUri: logo }); toast(t('admin.crud.saved')); };
  return (
    <AdminPage title={t('admin.nav.branding')} max={720}>
      <Card className="p-5">
        <Input testID="brand-name" label={t('admin.brand.appName')} value={name} onChangeText={setName} />
        <ImageField label={t('admin.brand.logo')} value={logo} onChange={setLogo} />
        <Txt className="text-muted text-[12px] mb-4">{t('admin.brand.note')}</Txt>
        <Button testID="brand-save" title={t('common.save')} onPress={save} />
      </Card>
    </AdminPage>
  );
}
