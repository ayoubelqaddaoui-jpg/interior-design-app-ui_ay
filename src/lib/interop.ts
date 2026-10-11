/**
 * NativeWind does not map `className` on Reanimated components on every platform
 * (on web the classes were silently dropped: lost margins / centring on animated wrappers).
 * Register the mapping once, before any screen renders.
 */
import Animated from 'react-native-reanimated';
import { cssInterop } from 'nativewind';

cssInterop(Animated.View, { className: 'style' });
cssInterop(Animated.Text, { className: 'style' });
