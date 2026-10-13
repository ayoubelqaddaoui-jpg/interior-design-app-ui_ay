import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToast } from '@/store/useToast';
import { Txt } from './Txt';

export function ToastHost() {
  const { msg, id } = useToast();
  const [expired, setExpired] = React.useState(0);
  const visible = !!msg && expired !== id;
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setExpired(id), 2400);
    return () => clearTimeout(t);
  }, [id, msg]);
  if (!visible) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 96 + insets.bottom, alignItems: 'center', zIndex: 999 }}>
      <Animated.View entering={FadeInDown.duration(220)} exiting={FadeOutDown.duration(180)} className="bg-ink rounded-full px-5 py-3 max-w-[90%]">
        <Txt className="text-onink font-semibold text-[14px] text-center">{msg}</Txt>
      </Animated.View>
    </View>
  );
}
