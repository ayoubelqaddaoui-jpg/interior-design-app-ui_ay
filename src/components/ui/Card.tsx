import React from 'react';
import { View, type ViewProps } from 'react-native';

export function Card({ className = '', ...p }: ViewProps & { className?: string }) {
  return <View {...p} className={`bg-surface rounded-2xl border border-line ${className}`} />;
}
