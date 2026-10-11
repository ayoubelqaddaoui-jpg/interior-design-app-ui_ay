import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Icon, Input, Sheet, Toggle, Txt } from '@/components/ui';
import { ICON_CHOICES } from '@/components/ui/Icon';
import { ColorPicker } from './ColorPicker';
import { ImageField } from './ImageField';
import { useStore } from '@/store/useStore';
import { useL, useT } from '@/i18n';
import type { LText } from '@/data/types';

export type Opt = { value: string; label: string };
export type Ctx = { s: ReturnType<typeof useStore.getState>; L: ReturnType<typeof useL>; t: ReturnType<typeof useT>['t'] };
type Base = { key: string; label: string; show?: (v: any) => boolean };
export type FieldDef =
  | (Base & { kind: 'text' | 'secret' | 'number'; required?: boolean; multiline?: boolean })
  | (Base & { kind: 'ltext'; multiline?: boolean })
  | (Base & { kind: 'bool' })
  | (Base & { kind: 'select'; options: (c: Ctx) => Opt[]; required?: boolean })
  | (Base & { kind: 'multi'; options: (c: Ctx) => Opt[] })
  | (Base & { kind: 'image' })
  | (Base & { kind: 'media' })
  | (Base & { kind: 'colors' })
  | (Base & { kind: 'icon' });

const LANG_LABELS: { k: keyof LText; key: string }[] = [{ k: 'dar', key: 'title_dar' }, { k: 'ar', key: 'title_ar' }, { k: 'fr', key: 'title_fr' }];

function Chips({ options, value, onChange, multi }: { options: Opt[]; value: any; onChange: (v: any) => void; multi?: boolean }) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((o) => {
        const on = multi ? (value as string[]).includes(o.value) : value === o.value;
        return (
          <Pressable key={o.value} testID={`chip-${o.value}`} onPress={() => onChange(multi ? (on ? (value as string[]).filter((x) => x !== o.value) : [...(value as string[]), o.value]) : o.value)}
            className={`px-3.5 h-9 rounded-full items-center justify-center flex-row gap-1.5 border ${on ? 'bg-primary border-primary' : 'bg-surface2 border-transparent'}`}>
            {on ? <Icon name="check" size={14} tone="onprimary" /> : null}
            <Txt className={`text-[13px] font-semibold ${on ? 'text-onprimary' : ''}`}>{o.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({ f, value, onChange, ctx, error }: { f: FieldDef; value: any; onChange: (v: any) => void; ctx: Ctx; error?: string }) {
  const { t } = ctx;
  const label = <Txt className="text-[13px] font-semibold text-muted mb-1.5">{f.label}</Txt>;
  switch (f.kind) {
    case 'text': case 'secret': case 'number':
      return <Input label={f.label} value={value == null ? '' : String(value)} error={error} secureTextEntry={f.kind === 'secret'} keyboardType={f.kind === 'number' ? 'numeric' : 'default'}
        multiline={'multiline' in f && f.multiline} style={'multiline' in f && f.multiline ? { minHeight: 120, textAlignVertical: 'top', paddingTop: 12 } : undefined}
        autoCapitalize={f.kind === 'secret' ? 'none' : undefined}
        onChangeText={(v) => onChange(f.kind === 'number' ? (v === '' ? 0 : Number(v.replace(/[^\d.-]/g, '')) || 0) : v)} />;
    case 'ltext':
      return (
        <View className="mb-1">
          {label}
          {LANG_LABELS.map(({ k, key }) => (
            <Input key={k} testID={`lt-${f.key}-${k}`} placeholder={t(`admin.f.${key}`)} value={(value as LText)?.[k] ?? ''} error={k === 'dar' ? error : undefined}
              multiline={f.multiline} style={{ textAlign: k === 'fr' ? 'left' : 'right', writingDirection: k === 'fr' ? 'ltr' : 'rtl' } as any}
              onChangeText={(v) => onChange({ ...(value ?? { dar: '', ar: '', fr: '' }), [k]: v })} />
          ))}
        </View>
      );
    case 'bool':
      return (
        <View className="flex-row items-center justify-between mb-4 bg-surface2 rounded-xl px-4 h-12">
          <Txt className="font-semibold text-[14px] flex-1">{f.label}</Txt>
          <Toggle testID={`sw-${f.key}`} label={f.label} value={!!value} onValueChange={onChange} />
        </View>
      );
    case 'select':
      return <View className="mb-4">{label}<Chips options={f.options(ctx)} value={value} onChange={onChange} />{error ? <Txt className="text-danger text-[12px] mt-1">{error}</Txt> : null}</View>;
    case 'multi':
      return <View className="mb-4">{label}<Chips multi options={f.options(ctx)} value={value ?? []} onChange={onChange} /></View>;
    case 'image':
      return <ImageField label={f.label} value={value ?? ''} onChange={onChange} />;
    case 'icon':
      return (
        <View className="mb-4">{label}
          <View className="flex-row flex-wrap gap-2">
            {ICON_CHOICES.map((n) => (
              <Pressable key={n} onPress={() => onChange(n)} className={`w-11 h-11 rounded-xl items-center justify-center ${value === n ? 'bg-primary' : 'bg-surface2'}`}><Icon name={n} size={22} tone={value === n ? 'onprimary' : 'fg'} /></Pressable>
            ))}
          </View>
        </View>
      );
    case 'media': {
      const m = value ?? { type: 'image', uri: '' };
      return (
        <View className="mb-2">{label}
          <Chips options={[{ value: 'image', label: t('admin.f.image') }, { value: 'video', label: t('admin.f.video') }]} value={m.type} onChange={(v) => onChange({ ...m, type: v })} />
          <View className="h-3" />
          {m.type === 'image'
            ? <ImageField label={t('admin.f.mediaUrl')} value={m.uri} onChange={(v) => onChange({ ...m, uri: v })} />
            : <><Input label={`${t('admin.f.mediaUrl')} (.mp4)`} value={m.uri} onChangeText={(v) => onChange({ ...m, uri: v })} autoCapitalize="none" placeholder="https://…/video.mp4" />
                <ImageField label={t('admin.f.poster')} value={m.poster ?? ''} onChange={(v) => onChange({ ...m, poster: v })} /></>}
        </View>
      );
    }
    case 'colors': {
      const list: string[] = value ?? [];
      return (
        <View className="mb-4">{label}
          {list.map((c, i) => (
            <View key={i} className="flex-row items-start gap-2">
              <View className="flex-1"><ColorPicker value={c} onChange={(v) => onChange(list.map((x, j) => (j === i ? v : x)))} /></View>
              <Pressable onPress={() => onChange(list.filter((_, j) => j !== i))} className="w-9 h-11 items-center justify-center"><Icon name="trash-can-outline" size={20} tone="danger" /></Pressable>
            </View>
          ))}
          <Button size="sm" variant="soft" icon="plus" title={t('common.add')} onPress={() => onChange([...list, '#CCCCCC'])} />
        </View>
      );
    }
  }
}

export function validate(fields: FieldDef[], v: any, t: Ctx['t']) {
  const err: Record<string, string> = {};
  v = v ?? {};
  for (const f of fields) {
    if (f.show && !f.show(v)) continue;
    if (f.kind === 'ltext') { const x = v[f.key] as LText; if (!x || !(x.dar || x.ar || x.fr)) err[f.key] = t('admin.crud.required'); }
    else if ((f.kind === 'text' || f.kind === 'select') && 'required' in f && f.required && !String(v[f.key] ?? '').trim()) err[f.key] = t('admin.crud.required');
  }
  return err;
}
/** Fill empty languages from the first filled one so the UI never shows blanks. */
export function normalize(fields: FieldDef[], v: any) {
  const out = { ...v };
  for (const f of fields) if (f.kind === 'ltext') {
    const x = out[f.key] as LText; const first = x.dar || x.ar || x.fr;
    out[f.key] = { dar: x.dar || first, ar: x.ar || first, fr: x.fr || first };
  }
  return out;
}

export function FormModal({ visible, title, fields, initial, onClose, onSubmit }: { visible: boolean; title: string; fields: FieldDef[]; initial: any; onClose: () => void; onSubmit: (v: any) => Promise<void> | void }) {
  const { t } = useT();
  const L = useL();
  const s = useStore();
  const [v, setV] = useState<any>(initial ?? {});
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  React.useEffect(() => { if (visible) { setV(initial ?? {}); setErr({}); } }, [visible, initial]);
  const ctx: Ctx = { s, L, t };
  const submit = async () => {
    const e = validate(fields, v, t);
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    await onSubmit(normalize(fields, v));
    setBusy(false);
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={title} wide>
      {/* `v` is never null: palettes / room types use show(v) callbacks that read v.isSurprise / v.displayMode */}
      {(visible ? fields : []).filter((f) => !f.show || f.show(v ?? {})).map((f) => <Field key={f.key} f={f} ctx={ctx} value={v?.[f.key]} error={err[f.key]} onChange={(x) => setV((p: any) => ({ ...p, [f.key]: x }))} />)}
      <View className="flex-row gap-3 mt-2">
        <Button title={t('common.cancel')} variant="soft" onPress={onClose} className="flex-1" />
        <Button testID="form-save" title={t('common.save')} onPress={submit} loading={busy} className="flex-1" />
      </View>
    </Sheet>
  );
}
