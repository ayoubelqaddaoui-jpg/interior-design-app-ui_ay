import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { Platform, View } from 'react-native';
import { vars } from 'nativewind';
import { StatusBar } from 'expo-status-bar';
import { useStore } from '@/store/useStore';
import { resolveTokens, toVars, type Tokens } from './tokens';
import type { ThemeConfig } from '@/data/types';

interface Ctx { colors: Tokens; dark: boolean; style: any }
const ThemeCtx = createContext<Ctx>(null as unknown as Ctx);
export const useTheme = () => useContext(ThemeCtx);

/** Build a theme context from any config (used for the live preview in the admin). */
export function useThemeFor(cfg: ThemeConfig): Ctx {
  return useMemo(() => {
    const r = resolveTokens(cfg);
    return { colors: r, dark: r.dark, style: vars(toVars(r)) };
  }, [cfg]);
}

export function ThemeScope({ config, children, className = 'flex-1' }: { config: ThemeConfig; children: React.ReactNode; className?: string }) {
  const ctx = useThemeFor(config);
  return (
    <ThemeCtx.Provider value={ctx}>
      <View style={ctx.style} className={`${className} bg-bg`}>{children}</View>
    </ThemeCtx.Provider>
  );
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const cfg = useStore((s) => s.doc?.theme) ?? { active: 'light', custom: {} };
  const ctx = useThemeFor(cfg);
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.body.style.backgroundColor = ctx.colors.bg;
  }, [ctx.colors.bg]);
  return (
    <ThemeCtx.Provider value={ctx}>
      <View style={ctx.style} className="flex-1 bg-bg">
        <StatusBar style={ctx.dark ? 'light' : 'dark'} />
        {children}
      </View>
    </ThemeCtx.Provider>
  );
}
