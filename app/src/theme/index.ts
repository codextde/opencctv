import { useColorScheme, type TextStyle } from 'react-native';

const light = {
  background: '#F3F4F6',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  surfaceSunken: '#E9EBEE',
  surfacePressed: '#E3E6EA',
  border: 'rgba(12,15,20,0.07)',
  borderStrong: 'rgba(12,15,20,0.14)',
  text: '#0C0F14',
  textSecondary: '#5A626E',
  textTertiary: '#8A919C',
  accent: '#0D9488',
  accentStrong: '#0F8277',
  accentSoft: 'rgba(13,148,136,0.12)',
  onAccent: '#FFFFFF',
  rec: '#E5484D',
  recSoft: 'rgba(229,72,77,0.12)',
  motion: '#D98A00',
  motionSoft: 'rgba(229,154,11,0.14)',
  warn: '#D98A00',
  warnSoft: 'rgba(229,154,11,0.13)',
  danger: '#E5484D',
  dangerSoft: 'rgba(229,72,77,0.11)',
  scrim: 'rgba(12,15,20,0.4)',
  video: '#000000',
  tile: '#16191E',
};

export type Palette = typeof light;

const dark: Palette = {
  background: '#0B0D10',
  surface: '#14171B',
  surfaceRaised: '#1A1E23',
  surfaceSunken: '#101317',
  surfacePressed: '#20252B',
  border: 'rgba(255,255,255,0.06)',
  borderStrong: 'rgba(255,255,255,0.12)',
  text: '#F1F3F5',
  textSecondary: '#98A0AA',
  textTertiary: '#636A74',
  accent: '#14B8A6',
  accentStrong: '#2DD4BF',
  accentSoft: 'rgba(45,212,191,0.13)',
  onAccent: '#03201C',
  rec: '#FF5A5F',
  recSoft: 'rgba(255,90,95,0.16)',
  motion: '#F5B544',
  motionSoft: 'rgba(245,181,68,0.16)',
  warn: '#F5B544',
  warnSoft: 'rgba(245,181,68,0.14)',
  danger: '#FF6369',
  dangerSoft: 'rgba(255,99,105,0.14)',
  scrim: 'rgba(0,0,0,0.6)',
  video: '#000000',
  tile: '#121519',
};

export const palettes = { light, dark };

export function useColors(): Palette {
  return useColorScheme() === 'light' ? light : dark;
}

export function useIsDark() {
  return useColorScheme() !== 'light';
}

export const onVideo = {
  text: '#FFFFFF',
  textSecondary: 'rgba(255,255,255,0.72)',
  glass: 'rgba(16,18,22,0.55)',
  glassStrong: 'rgba(16,18,22,0.78)',
  border: 'rgba(255,255,255,0.14)',
};

export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const radius = { xs: 6, sm: 10, md: 14, lg: 20, xl: 26, pill: 999 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, xxxl: 40 } as const;

const tabular: TextStyle['fontVariant'] = ['tabular-nums'];

export const type = {
  hero: { fontFamily: fonts.bold, fontSize: 40, lineHeight: 44, letterSpacing: -1.2 },
  title: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.8 },
  headline: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 23, letterSpacing: -0.3 },
  body: { fontFamily: fonts.regular, fontSize: 15.5, lineHeight: 22 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 15.5, lineHeight: 22 },
  callout: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 19 },
  caption: { fontFamily: fonts.medium, fontSize: 12.5, lineHeight: 16 },
  small: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 13 },
  label: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14, letterSpacing: 1.1, textTransform: 'uppercase' },
  value: { fontFamily: fonts.semibold, fontSize: 28, lineHeight: 32, letterSpacing: -0.6, fontVariant: tabular },
  mono: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 16, fontVariant: tabular },
  timecode: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 18, fontVariant: tabular, letterSpacing: 0.2 },
} satisfies Record<string, TextStyle>;
