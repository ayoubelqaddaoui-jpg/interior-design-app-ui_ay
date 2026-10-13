import React from 'react';
import { View } from 'react-native';
import { Txt } from '@/components/ui/Txt';
import type { Bucket, Metric } from '@/lib/stats';

/** Simple bar chart made of Views (no chart library needed, works on web + native). */
export function BarChart({ data, metric, height = 140, label }: { data: Bucket[]; metric: Metric; height?: number; label: (b: Bucket) => string }) {
  const max = Math.max(1, ...data.map((d) => d[metric]));
  const every = data.length > 14 ? Math.ceil(data.length / 6) : data.length > 7 ? 2 : 1;
  return (
    <View testID="dash-chart">
      <View className="flex-row items-end" style={{ height, gap: data.length > 20 ? 2 : 6 }}>
        {data.map((d, i) => {
          const v = d[metric];
          const h = v === 0 ? 3 : Math.max(8, Math.round((v / max) * (height - 18)));
          return (
            <View key={d.start} className="flex-1 items-center justify-end" style={{ height }}>
              {v > 0 && data.length <= 14 ? <Txt className="text-[10px] text-muted font-semibold mb-0.5">{v}</Txt> : null}
              <View className={v === 0 ? 'bg-line' : 'bg-primary'} style={{ width: '100%', maxWidth: 28, height: h, borderRadius: 6 }} />
            </View>
          );
        })}
      </View>
      <View className="flex-row mt-2" style={{ gap: data.length > 20 ? 2 : 6 }}>
        {data.map((d, i) => (
          <View key={d.start} className="flex-1 items-center">
            {i % every === 0 ? <Txt numberOfLines={1} className="text-[10px] text-muted" style={{ width: 40, textAlign: 'center' }}>{label(d)}</Txt> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

/** Horizontal ranked bars for "best features". */
export function RankBars({ rows, unit }: { rows: { id: string; label: string; count: number }[]; unit: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <View style={{ gap: 10 }}>
      {rows.map((r, i) => (
        <View key={r.id}>
          <View className="flex-row items-center justify-between mb-1 gap-2">
            <Txt numberOfLines={1} className={`text-[13px] flex-1 ${i === 0 ? 'font-extrabold' : 'font-semibold'}`}>{i + 1}. {r.label}</Txt>
            <Txt className="text-muted text-[12px]">{unit(r.count)}</Txt>
          </View>
          <View className="h-2 rounded-full bg-surface2 overflow-hidden">
            <View className={i === 0 ? 'bg-primary' : 'bg-ink'} style={{ width: `${Math.round((r.count / max) * 100)}%`, height: 8, borderRadius: 4, opacity: i === 0 ? 1 : 0.55 }} />
          </View>
        </View>
      ))}
    </View>
  );
}
