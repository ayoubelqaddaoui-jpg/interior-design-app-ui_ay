/**
 * The only module that statically imports react-native-gesture-handler (besides what it re-exports).
 * Screens reach it through React.lazy(() => import('@/components/GestureKit')), so the library is one on-demand chunk
 * instead of being pulled into the startup bundle by every route that uses it.
 */
export { BeforeAfter } from '@/components/result/BeforeAfter';
export { DragHandleDetector } from '@/components/admin/DragHandleDetector';
