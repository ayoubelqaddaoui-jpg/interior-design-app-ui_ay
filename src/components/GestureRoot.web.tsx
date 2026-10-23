import React from 'react';
import { View, type ViewProps } from 'react-native';
// Only the tiny context module: GestureDetector (loaded later, with the screens that use it) reads it to know a root exists.
import GestureHandlerRootViewContext from 'react-native-gesture-handler/lib/module/GestureHandlerRootViewContext';

/**
 * Identical to react-native-gesture-handler's own web GestureHandlerRootView (a flex:1 View that provides the context),
 * without importing the whole library (about 200 KB of JavaScript) before the first screen.
 */
export function GestureRoot({ style, ...rest }: ViewProps) {
  return (
    <GestureHandlerRootViewContext.Provider value>
      <View style={style ?? { flex: 1 }} {...rest} />
    </GestureHandlerRootViewContext.Provider>
  );
}
