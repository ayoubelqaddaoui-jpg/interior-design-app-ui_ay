import { GestureHandlerRootView } from 'react-native-gesture-handler';

/** App-wide gesture root. Native needs the real one; the web build uses GestureRoot.web.tsx so the gesture library stays out of the startup bundle. */
export const GestureRoot = GestureHandlerRootView;
