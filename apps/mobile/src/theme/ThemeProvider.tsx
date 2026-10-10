import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { dark, light, radius, spacing, typography, type Palette } from './tokens';

export interface Theme {
  scheme: 'light' | 'dark';
  colors: Palette;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
}

const make = (scheme: 'light' | 'dark'): Theme => ({ scheme, colors: scheme === 'dark' ? dark : light, spacing, radius, typography });
const ThemeContext = createContext<Theme>(make('light'));

/** Follows the OS appearance; `scheme` can be forced (tests, previews). */
export function ThemeProvider({ children, scheme }: { children: ReactNode; scheme?: 'light' | 'dark' }) {
  const system = useColorScheme();
  const resolved = scheme ?? (system === 'dark' ? 'dark' : 'light');
  const theme = useMemo(() => make(resolved), [resolved]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
