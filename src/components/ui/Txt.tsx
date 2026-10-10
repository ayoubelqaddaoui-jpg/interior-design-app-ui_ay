import React from 'react';
import { Text, type TextProps } from 'react-native';

const HAS_COLOR = /\btext-(fg|muted|primary|onprimary|onink|ink|danger|success|white|black|soft)\b/;
/** Text that defaults to the theme foreground colour. */
export function Txt({ className = '', ...p }: TextProps & { className?: string }) {
  return <Text {...p} className={`${HAS_COLOR.test(className) ? '' : 'text-fg '}${className}`} />;
}
