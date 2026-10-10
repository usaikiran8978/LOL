/**
 * Design tokens. Colour pairs are chosen for WCAG AA contrast (>= 4.5:1 for text on its intended background) in
 * both schemes; components reference roles, never raw hex values.
 */
export interface Palette {
  background: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  primary: string;
  onPrimary: string;
  primarySoft: string;
  border: string;
  borderStrong: string;
  danger: string;
  onDanger: string;
  dangerSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  focus: string;
  overlay: string;
  /** Brand gradient (primary buttons, logo, hero accents); `onGradient` text meets AA on both stops. */
  gradientStart: string;
  gradientEnd: string;
  onGradient: string;
  /** Swipe actions. */
  like: string;
  pass: string;
  superLike: string;
  /** Decorative gold for stars / sparkles (never text). */
  sparkle: string;
  /** Warm coral: decorative accents, icons, highlights (below AA as text — use `accentText` for words). */
  accent: string;
  accentText: string;
}

export const light: Palette = {
  background: '#FFF9F5',
  surface: '#FFFFFF',
  surfaceAlt: '#F3F2F5',
  text: '#24212A',
  textMuted: '#6B6475',
  primary: '#351B3F',
  onPrimary: '#FFFFFF',
  primarySoft: '#EAE2F4',
  border: '#E7E1EA',
  borderStrong: '#9A92A3',
  danger: '#B3261E',
  onDanger: '#FFFFFF',
  dangerSoft: '#FCE9E7',
  success: '#1E6B37',
  successSoft: '#E5F4EA',
  warning: '#7A4A00',
  warningSoft: '#FFF2DC',
  focus: '#1D5FD1',
  overlay: 'rgba(36,33,42,0.5)',
  gradientStart: '#351B3F',
  gradientEnd: '#6B2F5B',
  onGradient: '#FFFFFF',
  like: '#F27878',
  pass: '#6B6475',
  superLike: '#7C5CC4',
  sparkle: '#E9A86B',
  accent: '#F27878',
  accentText: '#B8434F',
};

export const dark: Palette = {
  background: '#1A1420',
  surface: '#241C2B',
  surfaceAlt: '#2F2537',
  text: '#F6F1F8',
  textMuted: '#C1B6C8',
  primary: '#E3CFEF',
  onPrimary: '#2A1430',
  primarySoft: '#3A2944',
  border: '#3B2F44',
  borderStrong: '#8C7F96',
  danger: '#FF8A80',
  onDanger: '#2D0000',
  dangerSoft: '#3B1614',
  success: '#7BD88F',
  successSoft: '#15301D',
  warning: '#FFC266',
  warningSoft: '#352611',
  focus: '#8AB4FF',
  overlay: 'rgba(0,0,0,0.6)',
  gradientStart: '#E3CFEF',
  gradientEnd: '#F4A9A9',
  onGradient: '#2A1430',
  like: '#F59A9A',
  pass: '#C1B6C8',
  superLike: '#B9A2F0',
  sparkle: '#F2C28F',
  accent: '#F59A9A',
  accentText: '#F59A9A',
};

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { sm: 8, md: 14, lg: 20, xl: 28, pill: 999 } as const;

/** Soft, plum-tinted elevation. */
export const elevation = {
  card: { shadowColor: '#351B3F', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  raised: { shadowColor: '#351B3F', shadowOpacity: 0.2, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
} as const;

export const fonts = { display: 'Anton_400Regular' } as const;

export const typography = {
  /** Editorial display face (Anton, condensed caps). Falls back to the system face until the font has loaded. */
  display: { fontSize: 34, lineHeight: 40, fontFamily: 'Anton_400Regular', textTransform: 'uppercase', letterSpacing: 0.3 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
} as const;
export type TypeVariant = keyof typeof typography;

/** Minimum touch target (Apple HIG 44pt; Material 48dp — we use 48 for primary controls). */
export const MIN_TOUCH = 44;
export const CONTROL_HEIGHT = 48;
