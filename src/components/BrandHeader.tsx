import React, { useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { Txt } from '@/components/ui/Txt';
import type { Branding } from '@/data/types';
import { useFontFamily } from '@/lib/fonts';
import { useStore } from '@/store/useStore';

/** A single responsive wordmark/image renderer shared by desktop, mobile and preview. */
export function BrandMark({ branding }: { branding: Branding }) {
  const [failed, setFailed] = useState('');
  const fontFamily = useFontFamily(branding.logoFont);
  const size = Math.min(40, Math.max(18, branding.logoSize ?? 28));
  const image = (branding.logoMode ?? (branding.logoUri ? 'image' : 'text')) === 'image' && branding.logoUri && failed !== branding.logoUri;
  return (
    <View testID="brand-mark" className={branding.logoStyle === 'badge' ? 'bg-soft rounded-2xl px-3 py-1' : ''} style={{ maxWidth: '100%', flexShrink: 1 }}>
      {image ? <Image accessibilityLabel={branding.appName} source={{ uri: branding.logoUri }} contentFit="contain" style={{ width: 140, maxWidth: '100%', height: 44 }} onError={() => setFailed(branding.logoUri)} /> :
        <Txt numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={{ fontFamily, color: branding.logoColor || undefined, fontSize: size, fontWeight: '800', fontStyle: branding.logoItalic ? 'italic' : 'normal', letterSpacing: branding.logoSpacing ?? -0.5, lineHeight: size * 1.4 }}>{branding.appName || 'Dwira'}</Txt>}
      {branding.logoStyle === 'signature' ? <View className="bg-primary rounded-full" style={{ height: 3, width: 28, marginTop: -2 }} /> : null}
    </View>
  );
}

/** Physical left/right placements stay consistent when switching between LTR and RTL. */
export function BrandHeader({ branding: preview, navigation, actions }: { branding?: Branding; navigation?: React.ReactNode; actions?: React.ReactNode }) {
  const saved = useStore((s) => s.doc.branding);
  const branding = preview ?? saved;
  const position = branding.logoPosition ?? 'left';
  const mark = <BrandMark branding={branding} />;
  return (
    <View testID={`brand-header-${position}`} style={{ flexDirection: 'row', direction: 'ltr', alignItems: 'center', minHeight: navigation && position === 'center' ? 108 : 64, gap: 12, flexWrap: position === 'center' && navigation ? 'wrap' : 'nowrap' }}>
      {position === 'left' ? mark : null}
      {position === 'center' ? <View style={navigation ? { width: '100%', alignItems: 'center', paddingTop: 4 } : { position: 'absolute', left: actions ? 64 : 0, right: actions ? 64 : 0, alignItems: 'center' }}>{mark}</View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>{navigation}</View>
      {actions}
      {position === 'right' ? mark : null}
    </View>
  );
}
