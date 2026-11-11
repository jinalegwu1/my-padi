import { useColorScheme } from 'react-native';

import { usePreferences } from '@/hooks/use-preferences';

/**
 * My PADI design tokens.
 *
 * Deep navy #101828 · electric blue #536DFE · soft purple #A78BFA · soft white #F8FAFC
 * Every screen reads colours through `useColors()` so light/dark mode and the
 * accessibility text scale stay consistent everywhere.
 */

export const brand = {
  navy: '#101828',
  blue: '#536DFE',
  purple: '#A78BFA',
  white: '#F8FAFC',
};

export type ColorScheme = 'light' | 'dark';

const light = {
  scheme: 'light' as ColorScheme,
  background: '#F8FAFC',
  backgroundAlt: '#F1F4FA',
  card: '#FFFFFF',
  cardMuted: '#F4F6FC',
  elevated: '#FFFFFF',
  text: '#101828',
  textSecondary: '#475467',
  muted: '#667085',
  border: '#E4E8F2',
  borderStrong: '#D0D7E6',
  primary: '#536DFE',
  primaryPressed: '#3F55D8',
  onPrimary: '#FFFFFF',
  primarySoft: '#EDF0FF',
  accent: '#8B6BF3',
  accentSoft: '#F2EDFF',
  userBubble: '#536DFE',
  userBubbleText: '#FFFFFF',
  padiBubble: '#FFFFFF',
  padiBubbleText: '#101828',
  danger: '#D92D20',
  dangerSoft: '#FEF3F2',
  success: '#0E9F6E',
  successSoft: '#E7F8F1',
  warning: '#B54708',
  warningSoft: '#FFF6E8',
  overlay: 'rgba(16, 24, 40, 0.45)',
  scrim: 'rgba(16, 24, 40, 0.06)',
  focus: '#536DFE',
  orbCore: '#536DFE',
  orbGlow: '#A78BFA',
  tabBar: '#FFFFFF',
  inputBackground: '#F4F6FC',
};

const dark: typeof light = {
  scheme: 'dark' as ColorScheme,
  background: '#0A0F1E',
  backgroundAlt: '#0E1526',
  card: '#141B2D',
  cardMuted: '#1A2236',
  elevated: '#1B2438',
  text: '#F8FAFC',
  textSecondary: '#C3CBDA',
  muted: '#98A2B3',
  border: '#25304A',
  borderStrong: '#33405E',
  primary: '#7C8CFF',
  primaryPressed: '#6A7BF5',
  onPrimary: '#0A0F1E',
  primarySoft: '#1B2340',
  accent: '#B9A2FF',
  accentSoft: '#241E3D',
  userBubble: '#4C63F0',
  userBubbleText: '#FFFFFF',
  padiBubble: '#141B2D',
  padiBubbleText: '#F8FAFC',
  danger: '#FF7B72',
  dangerSoft: '#2A1618',
  success: '#4ADE9B',
  successSoft: '#10261F',
  warning: '#FDB022',
  warningSoft: '#2A2010',
  overlay: 'rgba(3, 6, 14, 0.7)',
  scrim: 'rgba(255, 255, 255, 0.06)',
  focus: '#A5B2FF',
  orbCore: '#6C7DFF',
  orbGlow: '#B9A2FF',
  tabBar: '#0E1526',
  inputBackground: '#1A2236',
};

export const palette: Record<ColorScheme, typeof light> = { light, dark };

export type Colors = typeof light;

/**
 * Stronger text, borders and accents for the accessibility "Higher contrast"
 * setting. Only the keys that affect legibility are overridden.
 */
const highContrastOverrides: Record<ColorScheme, Partial<Colors>> = {
  light: {
    text: '#000000',
    textSecondary: '#1D2939',
    muted: '#344054',
    border: '#98A2B3',
    borderStrong: '#667085',
    primary: '#2E45C9',
    primaryPressed: '#22349B',
    accent: '#5B3FD1',
    userBubble: '#2E45C9',
    padiBubbleText: '#000000',
    danger: '#B42318',
    success: '#05603A',
    warning: '#7A2E0E',
  },
  dark: {
    text: '#FFFFFF',
    textSecondary: '#E4E7EC',
    muted: '#C3CBDA',
    border: '#4A5878',
    borderStrong: '#667085',
    primary: '#A5B2FF',
    primaryPressed: '#8E9DFF',
    accent: '#D6C7FF',
    userBubble: '#3B4FD8',
    padiBubbleText: '#FFFFFF',
    danger: '#FF9C94',
    success: '#6EE7B7',
    warning: '#FDB022',
  },
};

/** Resolves the active palette from the user's appearance preference. */
export function useColors(): Colors {
  const system = useColorScheme();
  const { preferences } = usePreferences();
  const mode = preferences.appearance;
  const scheme: ColorScheme = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
  const base = palette[scheme];
  if (!preferences.highContrast) return base;
  return { ...base, ...highContrastOverrides[scheme] };
}

/** Colours for an explicit scheme (used by the appearance preview swatches). */
export function colorsFor(scheme: ColorScheme): Colors {
  return palette[scheme];
}

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 28,
  xxl: 36,
  xxxl: 48,
};

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 26,
  pill: 999,
};

export const fonts = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
};

export type TypeScale = {
  display: number;
  title: number;
  heading: number;
  subheading: number;
  body: number;
  bodySmall: number;
  caption: number;
  micro: number;
  lineHeight: (size: number) => number;
};

/** Font sizes multiplied by the user's accessibility text scale. */
export function useType(): TypeScale {
  const { preferences } = usePreferences();
  const s = preferences.textScale;
  return {
    display: Math.round(30 * s),
    title: Math.round(23 * s),
    heading: Math.round(19 * s),
    subheading: Math.round(16.5 * s),
    body: Math.round(15.5 * s),
    bodySmall: Math.round(14 * s),
    caption: Math.round(12.5 * s),
    micro: Math.round(11 * s),
    lineHeight: (size: number) => Math.round(size * 1.45),
  };
}

export const shadow = {
  card: {
    shadowColor: '#101828',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  floating: {
    shadowColor: '#101828',
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
};
