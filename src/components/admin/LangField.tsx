import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Field';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { copySource, doneCount, LANG_ORDER, langStates, type LangInfo, type LangState } from '@/lib/langStatus';
import type { Lang, LText } from '@/data/types';

/** Status colours: green = complete, amber = incomplete (needs a look), red = missing. Always paired with an icon and a word, never colour alone. */
export function useLangPalette() {
  const { colors, dark } = useTheme();
  const amber = dark ? '#F5A524' : '#B45309';
  const meta: Record<LangState, { color: string; icon: string; key: string }> = {
    complete: { color: colors.success, icon: 'check-circle', key: 'langComplete' },
    incomplete: { color: amber, icon: 'alert-circle', key: 'langIncomplete' },
    missing: { color: colors.danger, icon: 'close-circle', key: 'langMissing' },
  };
  return meta;
}
const tint = (color: string, alpha = '22') => (/^#[0-9a-f]{6}$/i.test(color) ? color + alpha : color);
const CODE: Record<Lang, string> = { dar: 'DAR', ar: 'AR', fr: 'FR' };

/** Compact per-language badges (DAR · AR · FR), coloured by status. Used in list rows and previews. */
export function LangDots({ states, all }: { states: Record<Lang, LangState>; all?: boolean }) {
  const meta = useLangPalette();
  const { t } = useT();
  return (
    <View testID="lang-dots" accessibilityLabel={t('improve.langSummary', { done: doneCount(states), total: 3 })} className="flex-row items-center gap-1" style={{ flexShrink: 0 }}>
      {LANG_ORDER.map((l) => {
        const m = meta[states[l]];
        const quiet = !all && states[l] === 'complete';
        return (
          <View key={l} testID={`lang-dot-${l}-${states[l]}`} className="flex-row items-center rounded-full px-1.5 h-5 gap-0.5" style={{ backgroundColor: tint(m.color, quiet ? '14' : '26') }}>
            <Icon name={m.icon} size={10} color={m.color} />
            <Txt className="text-[9.5px] font-extrabold" style={{ color: m.color, opacity: quiet ? 0.7 : 1 }}>{CODE[l]}</Txt>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Multilingual text field. Every language shows its own status (complete / incomplete / missing), recomputed on every keystroke.
 *  - wide containers (dialogs on desktop and tablet): the three languages side by side, header with status above each input
 *  - narrow containers (phones): one compact line per language, status word next to its name
 * Nothing is hidden behind tabs: an untranslated language is always visible and one tap away from being filled.
 */
export function LangField({ label, fieldKey, value, onChange, error, multiline }: { label: string; fieldKey: string; value?: LText; onChange: (v: LText) => void; error?: string; multiline?: boolean }) {
  const { t } = useT();
  const meta = useLangPalette();
  const [width, setWidth] = useState(0);
  const states = langStates(value);
  const wide = width >= 540;
  const done = doneCount(states);
  const worstState: LangState = LANG_ORDER.some((l) => states[l].state === 'missing') ? 'missing' : LANG_ORDER.some((l) => states[l].state === 'incomplete') ? 'incomplete' : 'complete';
  const name = (l: Lang) => t(`admin.f.title_${l}`);
  const set = (l: Lang, v: string) => onChange({ ...(value ?? { dar: '', ar: '', fr: '' }), [l]: v });
  const hint = (info: LangInfo) => info.state !== 'incomplete' ? '' : info.reason === 'copy' ? t('improve.langCopyHint', { lang: name(info.of as Lang) }) : t('improve.langScriptHint');
  const status = (l: Lang) => {
    const info = states[l];
    const m = meta[info.state];
    return { info, m, word: t(`improve.${m.key}`), source: info.state === 'missing' ? copySource(value, l) : undefined };
  };
  const input = (l: Lang, extra?: object) => (
    <Input key={l} tight language={l} testID={`lt-${fieldKey}-${l}`} placeholder={name(l)} accessibilityLabel={`${label} · ${name(l)} · ${t(`improve.${meta[states[l].state].key}`)}`}
      value={value?.[l] ?? ''} multiline={multiline} invalid={!!error && states[l].state === 'missing'}
      style={{ textAlign: l === 'fr' ? 'left' : 'right', writingDirection: l === 'fr' ? 'ltr' : 'rtl', ...(extra ?? {}) } as any}
      onChangeText={(v) => set(l, v)} />
  );
  const copyButton = (l: Lang, source?: Lang) => source ? (
    <Pressable testID={`lt-${fieldKey}-${l}-copy`} accessibilityRole="button" accessibilityLabel={t('improve.langCopyFrom', { lang: name(source) })} onPress={() => set(l, value?.[source] ?? '')} hitSlop={6} className="w-8 h-8 rounded-full bg-surface2 items-center justify-center active:opacity-70"><Icon name="content-copy" size={15} tone="muted" /></Pressable>
  ) : null;

  return (
    <View testID={`lang-field-${fieldKey}`} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ minWidth: 0 }}>
      <View className="flex-row items-center justify-between gap-3 mb-2">
        <Txt className="text-[13px] font-semibold text-muted flex-shrink" numberOfLines={1} style={{ flexShrink: 1 }}>{label}</Txt>
        <View testID={`lang-summary-${fieldKey}`} accessibilityLabel={t('improve.langSummary', { done, total: 3 })} className="flex-row items-center gap-1.5" style={{ flexShrink: 0 }}>
          {LANG_ORDER.map((l) => <View key={l} style={{ width: 16, height: 5, borderRadius: 3, backgroundColor: meta[states[l].state].color }} />)}
          <Txt className="text-[12px] font-extrabold" style={{ color: meta[worstState].color }}>{done}/3</Txt>
        </View>
      </View>
      {wide ? (
        <View className="flex-row gap-2.5" style={{ alignItems: 'flex-start' }}>
          {LANG_ORDER.map((l) => {
            const { info, m, word, source } = status(l);
            return (
              <View key={l} testID={`lang-col-${fieldKey}-${l}`} style={{ flex: 1, minWidth: 0 }}>
                <View className="flex-row items-center gap-1.5 mb-1" style={{ minHeight: 26 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: m.color }} />
                  <Txt className="text-[12.5px] font-bold" numberOfLines={1} style={{ flexShrink: 1 }}>{name(l)}</Txt>
                  <View className="flex-row items-center gap-1 flex-1 justify-end" style={{ minWidth: 0 }}>
                    <Icon name={m.icon} size={14} color={m.color} />
                    <Txt testID={`lang-status-${fieldKey}-${l}`} className="text-[11.5px] font-bold" numberOfLines={1} style={{ color: m.color, flexShrink: 1 }}>{word}</Txt>
                    {copyButton(l, source)}
                  </View>
                </View>
                {input(l)}
                {hint(info) ? <Txt className="text-[11px] mt-1" style={{ color: m.color }}>{hint(info)}</Txt> : null}
              </View>
            );
          })}
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {LANG_ORDER.map((l) => {
            const { info, m, word, source } = status(l);
            return (
              <View key={l} testID={`lang-row-${fieldKey}-${l}`}>
                <View className="flex-row gap-2" style={{ alignItems: multiline ? 'flex-start' : 'center' }}>
                  <View style={{ width: 74, paddingTop: multiline ? 6 : 0 }}>
                    <View className="flex-row items-center gap-1.5">
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: m.color }} />
                      <Txt className="text-[12.5px] font-bold" numberOfLines={1} style={{ flexShrink: 1 }}>{name(l)}</Txt>
                    </View>
                    <View className="flex-row items-center gap-1 mt-0.5">
                      <Icon name={m.icon} size={12} color={m.color} />
                      <Txt testID={`lang-status-${fieldKey}-${l}`} className="text-[11px] font-bold" numberOfLines={1} style={{ color: m.color, flexShrink: 1 }}>{word}</Txt>
                    </View>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>{input(l)}</View>
                  {copyButton(l, source)}
                </View>
                {hint(info) ? <Txt className="text-[11px] mt-0.5" style={{ color: m.color, marginStart: 82 }}>{hint(info)}</Txt> : null}
              </View>
            );
          })}
        </View>
      )}
      {error ? <Txt testID={`lang-error-${fieldKey}`} className="text-danger text-[12px] mt-1.5">{error}</Txt> : null}
    </View>
  );
}
