import React from 'react';
import { View } from 'react-native';
import { Icon } from '@/components/ui/Icon';

const ICONS = ['home-variant', 'compass-outline', 'clock-outline', 'face-agent'];

/** Tiny schematic mock-ups of each navigation variant (user bottom bar / admin menu). */
export function NavPreview({ kind, id }: { kind: 'user' | 'admin'; id: string }) {
  if (kind === 'user') {
    const row = (
      <View className="flex-row items-center justify-around" style={{ width: '100%' }}>
        {ICONS.map((n, i) => {
          const on = i === 0;
          if (id === 'floating') return <View key={n} className={`h-8 rounded-full items-center justify-center flex-row gap-1 ${on ? 'bg-ink px-3' : 'w-8'}`}><Icon name={n} size={16} tone={on ? 'onink' : 'muted'} />{on ? <View className="h-1.5 w-8 rounded-full bg-onink" /> : null}</View>;
          if (id === 'minimal') return <View key={n} className="items-center" style={{ width: 40 }}><View className={`h-[3px] w-6 rounded-b-full mb-1 ${on ? 'bg-primary' : ''}`} /><Icon name={n} size={17} tone={on ? 'fg' : 'muted'} /><View className="h-1 w-6 rounded-full bg-line mt-1" /></View>;
          return <View key={n} className="items-center" style={{ width: 40 }}><View className={`h-6 w-10 rounded-full items-center justify-center ${on ? 'bg-soft' : ''}`}><Icon name={n} size={16} tone={on ? 'fg' : 'muted'} /></View><View className="h-1 w-6 rounded-full bg-line mt-1" /></View>;
        })}
      </View>
    );
    return (
      <View className="flex-1 w-full justify-end">
        <View className="flex-1 p-3 gap-2"><View className="h-3 w-24 rounded bg-line" /><View className="flex-1 rounded-lg bg-line" style={{ opacity: 0.6 }} /></View>
        {id === 'floating'
          ? <View className="px-4 pb-3"><View className="bg-surface border border-line rounded-full py-1.5 px-1.5">{row}</View></View>
          : <View className={`${id === 'minimal' ? 'bg-bg' : 'bg-surface'} border-t border-line py-2 px-2`}>{row}</View>}
      </View>
    );
  }
  const bar = (w: number, on = false) => <View className={`h-2 rounded-full ${on ? 'bg-primary' : 'bg-line'}`} style={{ width: w }} />;
  const content = (
    <View className="flex-1 p-3 gap-2"><View className="h-3 w-20 rounded bg-line" /><View className="flex-row gap-2"><View className="flex-1 h-10 rounded-lg bg-line" style={{ opacity: 0.6 }} /><View className="flex-1 h-10 rounded-lg bg-line" style={{ opacity: 0.6 }} /></View><View className="flex-1 rounded-lg bg-line" style={{ opacity: 0.4 }} /></View>
  );
  if (id === 'top') {
    return (
      <View className="flex-1 w-full"><View className="bg-surface border-b border-line px-2 py-2 flex-row gap-2 items-center">{[0, 1, 2, 3].map((i) => <View key={i} className={`h-5 rounded-full ${i === 0 ? 'bg-primary w-12' : 'bg-line w-9'}`} />)}</View>{content}</View>
    );
  }
  if (id === 'rail') {
    return (
      <View className="flex-1 w-full flex-row"><View className="w-9 bg-surface border-e border-line items-center py-2 gap-2">{[0, 1, 2, 3, 4].map((i) => <View key={i} className={`w-5 h-5 rounded-md ${i === 0 ? 'bg-primary' : 'bg-line'}`} />)}</View>{content}</View>
    );
  }
  return (
    <View className="flex-1 w-full flex-row"><View className="w-[84px] bg-surface border-e border-line p-2 gap-2.5">{bar(30)}{[0, 1, 2, 3].map((i) => <View key={i} className="flex-row items-center gap-1.5"><View className={`w-3.5 h-3.5 rounded ${i === 0 ? 'bg-primary' : 'bg-line'}`} />{bar(i === 0 ? 38 : 30, i === 0)}</View>)}</View>{content}</View>
  );
}
