import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { Sheet } from '@/components/ui/Sheet';
import { Txt } from '@/components/ui/Txt';
import { ensureFont, useFontFamily } from '@/lib/fonts';
import { useT } from '@/i18n';
import { toast } from '@/store/useToast';

function FontOption({ font, selected, rtl, sample, onSelect }: { font: string; selected: boolean; rtl: boolean; sample: string; onSelect: () => void }) {
  const family = useFontFamily(font, rtl ? 'Tajawal' : 'Inter');
  const { t } = useT();
  return <Pressable testID={`chip-${font}`} accessibilityRole="radio" aria-checked={selected} accessibilityState={{ selected }} onPress={() => { ensureFont(font).then(onSelect).catch(() => toast(t('improve.saveError'))); }} className={`rounded-xl border p-3 mb-2 ${selected ? 'border-primary bg-soft' : 'border-line bg-surface'}`}>
    <View className="flex-row items-center gap-2"><Txt style={{ fontFamily: family, lineHeight: 24 }} className="flex-1 text-[15px]">{font}</Txt><Icon name={selected ? 'check-circle' : 'radiobox-blank'} tone={selected ? 'primary' : 'muted'} size={20} /></View>
    <Txt style={{ fontFamily: family, writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left', fontSize: rtl ? 21 : 17, lineHeight: 32 }} className="mt-2">{sample}</Txt>
  </Pressable>;
}
/** Specimens load only when the dropdown opens; the active preference previews app-wide. */
export function FontSelector({ value, options, language, onChange }: { value?: string; options: string[]; language: 'fr' | 'ar'; onChange: (font: string) => void }) {
  const [open, setOpen] = useState(false);
  const { t } = useT();
  const rtl = language === 'ar';
  const selected = options.includes(value ?? '') ? value! : options[0];
  const family = useFontFamily(selected, rtl ? 'Tajawal' : 'Inter');
  const sample = rtl ? 'مساحة تُلهمك، وتفاصيل تشبهك.' : 'Un intérieur qui vous ressemble.';
  const label = t(rtl ? 'improve.chooseArabicFont' : 'improve.chooseFrenchFont');
  return <View className="flex-1" style={{ minWidth: 0 }}>
    <Txt className="font-semibold text-muted text-[12px] mb-2">{t(rtl ? 'improve.arabicFont' : 'improve.frenchFont')}</Txt>
    <Pressable testID={`font-dropdown-${language}`} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} onPress={() => setOpen(true)} className="flex-row items-center border border-line rounded-xl bg-surface2 px-3 h-11 gap-2">
      <Txt style={{ fontFamily: family, lineHeight: 26 }} className="flex-1" numberOfLines={1}>{selected}</Txt><Icon name="chevron-down" size={18} />
    </Pressable>
    <View testID={`font-preview-${language}`} className="rounded-xl bg-soft p-3 mt-2" style={{ direction: rtl ? 'rtl' : 'ltr', minHeight: 115 }}>
      <Txt style={{ fontFamily: family, fontSize: rtl ? 23 : 19, lineHeight: rtl ? 36 : 29, writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left' }}>{sample}</Txt>
      <Txt style={{ fontFamily: family, writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left', lineHeight: 22 }} className="text-muted text-[12px] mt-1">{rtl ? 'من الفكرة إلى بيتك · ١٢٣' : 'De l’idée à votre maison · 123'}</Txt>
    </View>
    <Sheet visible={open} onClose={() => setOpen(false)} title={label}>
      {open ? options.map((font) => <FontOption key={font} font={font} selected={font === selected} rtl={rtl} sample={sample} onSelect={() => { onChange(font); setOpen(false); }} />) : null}
    </Sheet>
  </View>;
}
