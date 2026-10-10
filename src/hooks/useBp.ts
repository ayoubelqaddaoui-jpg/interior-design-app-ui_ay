import { useWindowDimensions } from 'react-native';

/** Responsive helper shared by every screen (same components, different column counts). */
export function useBp() {
  const { width, height } = useWindowDimensions();
  const desktop = width >= 1024;
  const tablet = width >= 700;
  const pick = <T,>(m: T, t: T, d: T) => (desktop ? d : tablet ? t : m);
  return { width, height, desktop, tablet, pick };
}
