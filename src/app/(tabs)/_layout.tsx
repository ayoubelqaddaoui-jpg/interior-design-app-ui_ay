import React from 'react';
import { Pressable, View } from 'react-native';
import { Tabs } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useT } from '@/i18n';
import { useBp } from '@/hooks/useBp';
import { Icon, Txt } from '@/components/ui';
import { useStore } from '@/store/useStore';
import { CreditsBadge } from '@/components/ui';

const TABS = [
  { name: 'index', key: 'tabs.home', icon: 'home-variant-outline', on: 'home-variant' },
  { name: 'explore', key: 'tabs.explore', icon: 'compass-outline', on: 'compass' },
  { name: 'history', key: 'tabs.history', icon: 'clock-outline', on: 'clock' },
  { name: 'assistant', key: 'tabs.assistant', icon: 'face-agent', on: 'face-agent' },
] as const;

function Item({ focused, label, icon, on, onPress, desktop, name }: { focused: boolean; label: string; icon: string; on: string; onPress: () => void; desktop: boolean; name: string }) {
  const a = useAnimatedStyle(() => ({ transform: [{ scale: withSpring(focused ? 1.06 : 1, { damping: 14 }) }] }));
  if (desktop) {
    return (
      <Pressable testID={`tab-${name}`} onPress={onPress} className={`flex-row items-center gap-2 h-10 px-4 rounded-full ${focused ? 'bg-primary' : 'active:bg-surface2'}`}>
        <Icon name={focused ? on : icon} size={20} tone={focused ? 'onprimary' : 'fg'} />
        <Txt className={`font-bold text-[14px] ${focused ? 'text-onprimary' : 'text-fg'}`}>{label}</Txt>
      </Pressable>
    );
  }
  return (
    <Pressable testID={`tab-${name}`} onPress={onPress} className="flex-1 items-center justify-center">
      <Animated.View style={a} className="items-center">
        <View className={`w-12 h-12 rounded-full items-center justify-center ${focused ? 'bg-ink' : ''}`}>
          <Icon name={focused ? on : icon} size={22} tone={focused ? 'onink' : 'fg'} />
        </View>
        <Txt className={`text-[10px] -mt-1 ${focused ? 'font-extrabold' : 'text-muted'}`}>{label}</Txt>
      </Animated.View>
    </Pressable>
  );
}

function TabBar({ state, navigation }: any) {
  const { t } = useT();
  const { desktop } = useBp();
  const insets = useSafeAreaInsets();
  const branding = useStore((s) => s.doc.branding);
  const items = TABS.map((tab) => {
    const idx = state.routes.findIndex((r: any) => r.name === tab.name);
    const focused = state.index === idx;
    return (
      <Item key={tab.name} name={tab.name} desktop={desktop} focused={focused} label={t(tab.key)} icon={tab.icon} on={tab.on}
        onPress={() => { const e = navigation.emit({ type: 'tabPress', target: state.routes[idx].key, canPreventDefault: true }); if (!focused && !e.defaultPrevented) navigation.navigate(tab.name); }} />
    );
  });
  if (desktop) {
    return (
      <View className="bg-bg border-b border-line" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center h-16 px-8 w-full self-center" style={{ maxWidth: 1280 }}>
          <Txt className="text-[24px] font-black mr-8 ml-8">{branding.appName}</Txt>
          <View className="flex-row gap-2 flex-1">{items}</View>
          <CreditsBadge />
        </View>
      </View>
    );
  }
  return (
    <View className="bg-bg" style={{ paddingBottom: Math.max(insets.bottom, 6), paddingTop: 6 }}>
      <View className="flex-row h-[62px] px-2">{items}</View>
    </View>
  );
}

export default function TabsLayout() {
  const { desktop } = useBp();
  return (
    <Tabs
      tabBar={(p) => <TabBar {...p} />}
      screenOptions={{ headerShown: false, tabBarPosition: desktop ? 'top' : 'bottom', sceneStyle: { backgroundColor: 'transparent' } } as any}
    >
      {TABS.map((t) => <Tabs.Screen key={t.name} name={t.name} />)}
    </Tabs>
  );
}
