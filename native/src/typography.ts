/** VantraRun type (brand v1): Barlow Condensed for display, headings and stats; Inter for
 * everything else. The .ttf files ship inside the app (see `fontAssets`); nothing is fetched.
 *
 * Each face is loaded under its own family name, so a style sets `fontFamily` only.
 * Do not add `fontWeight` or `fontStyle` to these: the name already picks the cut, and a
 * weight on top makes Android fall back to a system font.
 */
import type { TextStyle } from 'react-native';
import { BarlowCondensed_600SemiBold } from '@expo-google-fonts/barlow-condensed/600SemiBold';
import { BarlowCondensed_800ExtraBold } from '@expo-google-fonts/barlow-condensed/800ExtraBold';
import { BarlowCondensed_900Black_Italic } from '@expo-google-fonts/barlow-condensed/900Black_Italic';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { brand } from './theme';

export const fonts = {
  display: 'BarlowCondensed_900Black_Italic',
  heading: 'BarlowCondensed_600SemiBold',
  stat: 'BarlowCondensed_800ExtraBold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodyStrong: 'Inter_600SemiBold',
} as const;

/** Passed to `useFonts` in the root layout. Keys are the family names above. */
export const fontAssets = {
  [fonts.display]: BarlowCondensed_900Black_Italic,
  [fonts.heading]: BarlowCondensed_600SemiBold,
  [fonts.stat]: BarlowCondensed_800ExtraBold,
  [fonts.body]: Inter_400Regular,
  [fonts.bodyMedium]: Inter_500Medium,
  [fonts.bodyStrong]: Inter_600SemiBold,
};

/** Screen heroes and the big finished-run number. The italic Black cut leans past its
 * advance width, so a little right padding stops the last letter being clipped. */
export function display(size: number): TextStyle {
  return { fontFamily: fonts.display, fontSize: size, lineHeight: Math.round(size * 0.96), textTransform: 'uppercase',
    letterSpacing: 0, color: brand.chalk, paddingRight: Math.ceil(size * 0.08) };
}

/** Section and card titles. */
export function heading(size: number): TextStyle {
  return { fontFamily: fonts.heading, fontSize: size, lineHeight: Math.round(size * 1.15), textTransform: 'uppercase',
    letterSpacing: size * 0.06, color: brand.chalk };
}

/** Pace, time and distance values. */
export function stat(size: number): TextStyle {
  return { fontFamily: fonts.stat, fontSize: size, lineHeight: Math.round(size * 1.05), letterSpacing: 0,
    fontVariant: ['tabular-nums'], color: brand.chalk };
}

export const type = {
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: brand.text2 } satisfies TextStyle,
  bodyLarge: { fontFamily: fonts.body, fontSize: 17, lineHeight: 25, color: brand.text2 } satisfies TextStyle,
  bodyMedium: { fontFamily: fonts.bodyMedium, fontSize: 15, lineHeight: 22, color: brand.chalk } satisfies TextStyle,
  bodyStrong: { fontFamily: fonts.bodyStrong, fontSize: 15, lineHeight: 22, color: brand.chalk } satisfies TextStyle,
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: brand.steel } satisfies TextStyle,
  /** Stat labels and overlines: 0.14em tracking at 11 px. */
  label: { fontFamily: fonts.bodyMedium, fontSize: 11, lineHeight: 16, textTransform: 'uppercase', letterSpacing: 1.54,
    color: brand.steel } satisfies TextStyle,
};
