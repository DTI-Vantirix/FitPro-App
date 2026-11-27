/** The VantraRun component kit: logo, type, buttons, cards, inputs and stat blocks.
 * Shapes follow the website: Volt pill buttons, Graphite cards with a Line border, no shadows.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View,
  type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { brand, colors } from '../theme';
import { display, fonts, heading, stat, type } from '../typography';

export type IconName = React.ComponentProps<typeof Feather>['name'];

export function Icon({ name, size = 20, color = colors.text }: { name: IconName; size?: number; color?: string }) {
  return <Feather name={name} size={size} color={color} />;
}

// ---- Logo -------------------------------------------------------------------------------
// Real pixel sizes of the kit PNGs in assets/brand; width is always derived from height.
const LOGOS = {
  horizontal: { source: require('../../assets/brand/vantrarun-horizontal-full-colour-1000w.png'), ratio: 1000 / 195 },
  stacked: { source: require('../../assets/brand/vantrarun-stacked-full-colour-512h.png'), ratio: 362 / 512 },
  mark: { source: require('../../assets/brand/vantrarun-mark-neon-256.png'), ratio: 1 },
} as const;

export function Logo({ variant = 'horizontal', height }: { variant?: keyof typeof LOGOS; height?: number }) {
  const logo = LOGOS[variant];
  const h = height ?? (variant === 'stacked' ? 112 : variant === 'mark' ? 32 : 26);
  return <Image source={logo.source} accessibilityRole="image" accessibilityLabel="VantraRun" resizeMode="contain"
    style={{ height: h, width: Math.round(h * logo.ratio) }} />;
}

/** Header of the signed-in screens: the horizontal logo, with an optional back button and right-hand slot. */
export function ScreenHeader({ onBack, right }: { onBack?: () => void; right?: React.ReactNode }) {
  return <View style={styles.header}>
    <View style={styles.headerLeft}>
      {onBack && <IconButton icon="arrow-left" label="Back" onPress={onBack} />}
      <Logo variant="horizontal" />
    </View>
    {!!right && <View style={styles.headerRight}>{right}</View>}
  </View>;
}

/** Top of the sign-in, sign-up, invite, consent and setup screens. */
export function AuthHero({ title, subtitle }: { title: string; subtitle?: string }) {
  return <View style={styles.hero}>
    <Logo variant="stacked" />
    <Text style={[type.label, styles.tagline]}>Own every mile.</Text>
    <Text accessibilityRole="header" style={[display(38), styles.center]}>{title}</Text>
    {!!subtitle && <Text style={[type.bodyLarge, styles.center, styles.heroSubtitle]}>{subtitle}</Text>}
  </View>;
}

// ---- Text -------------------------------------------------------------------------------
export function Label({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[type.label, style]}>{children}</Text>;
}

export function Heading({ children, size = 18, style }: { children: React.ReactNode; size?: number; style?: StyleProp<TextStyle> }) {
  return <Text accessibilityRole="header" style={[heading(size), style]}>{children}</Text>;
}

export function Body({ children, style, selectable }: { children: React.ReactNode; style?: StyleProp<TextStyle>; selectable?: boolean }) {
  return <Text selectable={selectable} style={[type.body, style]}>{children}</Text>;
}

/** Overline, display title and optional lead paragraph at the top of a screen. */
export function SectionHeading({ kicker, title, subtitle }: { kicker?: string; title: string; subtitle?: string }) {
  return <View style={styles.heading}>
    {!!kicker && <Text style={type.label}>{kicker}</Text>}
    <Text accessibilityRole="header" style={display(36)}>{title}</Text>
    {!!subtitle && <Text style={type.body}>{subtitle}</Text>}
  </View>;
}

// ---- Inputs -----------------------------------------------------------------------------
export function Field({ label, value, onChangeText, secure = false, keyboardType = 'default', autoCapitalize = 'none', placeholder, multiline = false, maxLength }: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  secure?: boolean;
  keyboardType?: 'default' | 'email-address' | 'number-pad' | 'decimal-pad';
  autoCapitalize?: 'none' | 'sentences';
  placeholder?: string;
  /** A few lines of free text (a caption). */
  multiline?: boolean;
  maxLength?: number;
}) {
  const [focused, setFocused] = useState(false);
  return <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput
      accessibilityLabel={label}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.subtle}
      selectionColor={colors.accent}
      autoCapitalize={autoCapitalize}
      autoCorrect={false}
      secureTextEntry={secure}
      keyboardType={keyboardType}
      multiline={multiline}
      maxLength={maxLength}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.input, multiline && styles.inputMultiline, focused && styles.inputFocused]}
    />
  </View>;
}

export function Toggle({ label, value, onValueChange }: { label: string; value: boolean; onValueChange: (on: boolean) => void }) {
  return <Switch accessibilityLabel={label} value={value} onValueChange={onValueChange}
    trackColor={{ false: brand.line, true: brand.volt }} thumbColor={value ? brand.ink : brand.chalk} ios_backgroundColor={brand.line} />;
}

// ---- Buttons ----------------------------------------------------------------------------
export type ActionVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/** Primary: Volt pill, Ink text. Secondary: Chalk outline pill. Ghost: Volt text only.
 * Danger: the outline pill in the error colour, for destructive actions. */
export function Action({ label, onPress, busy = false, disabled = false, secondary = false, variant, icon, compact = false }: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  secondary?: boolean;
  variant?: ActionVariant;
  icon?: IconName;
  compact?: boolean;
}) {
  const kind: ActionVariant = variant ?? (secondary ? 'secondary' : 'primary');
  const ink = kind === 'primary' ? colors.accentText : kind === 'ghost' ? colors.accent : kind === 'danger' ? colors.danger : colors.text;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || disabled, busy }}
    disabled={busy || disabled} onPress={onPress}
    style={({ pressed }) => [
      styles.action,
      compact && styles.actionCompact,
      kind === 'secondary' && styles.secondary,
      kind === 'danger' && styles.dangerAction,
      kind === 'ghost' && styles.ghost,
      pressed && !(busy || disabled) && styles.pressed,
      (busy || disabled) && styles.disabled,
    ]}>
    {busy ? <ActivityIndicator color={ink} /> : icon ? <Feather name={icon} size={18} color={ink} /> : null}
    <Text style={[styles.actionText, { color: ink }]}>{label}</Text>
  </Pressable>;
}

/** Round outline button. `active` marks the screen you are on (Volt ring and icon), as the
 * website's header does. 'trophy' is the one icon Feather lacks; it comes from Ionicons. */
export function IconButton({ icon, label, onPress, active = false }: { icon: IconName | 'trophy'; label: string; onPress: () => void; active?: boolean }) {
  const tint = active ? colors.accent : colors.text;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }} onPress={onPress} hitSlop={6}
    style={({ pressed }) => [styles.iconButton, active && styles.iconButtonActive, pressed && styles.pressed]}>
    {icon === 'trophy' ? <Ionicons name="trophy-outline" size={18} color={tint} /> : <Feather name={icon} size={18} color={tint} />}
  </Pressable>;
}

// ---- Surfaces ---------------------------------------------------------------------------
/** Graphite card with a Line border. `selected` swaps the border for Volt. */
export function Card({ children, style, selected = false }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; selected?: boolean }) {
  return <View style={[styles.card, selected && styles.cardSelected, style]}>{children}</View>;
}

export function ErrorNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return <View accessibilityRole="alert" style={styles.error}>
    <Feather name="alert-circle" size={18} color={colors.danger} style={styles.errorIcon} />
    <Text selectable style={styles.errorText}>{message}</Text>
  </View>;
}

/** A plain notice that is not an error: neutral card, wording carries it. */
export function Notice({ children, icon = 'info' }: { children: React.ReactNode; icon?: IconName }) {
  return <View style={[styles.card, styles.notice]}>
    <Feather name={icon} size={18} color={colors.text} style={styles.errorIcon} />
    <Text style={[type.body, styles.noticeText]}>{children}</Text>
  </View>;
}

// ---- Stats ------------------------------------------------------------------------------
export type StatBlockProps = {
  label: string;
  value: string;
  unit?: string;
  /** Live or record value: Volt. Everything else is Chalk. */
  highlight?: boolean;
  size?: number;
  caption?: string;
  align?: 'left' | 'center';
};

/** Steel label above a Barlow ExtraBold value. */
export function StatBlock({ label, value, unit, highlight = false, size = 28, caption, align = 'left' }: StatBlockProps) {
  return <View style={[styles.statBlock, align === 'center' && styles.statCenter]}>
    <Text style={type.label} numberOfLines={1}>{label}</Text>
    <View style={styles.statValueRow}>
      <Text style={[stat(size), highlight && { color: colors.accent }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {!!unit && <Text style={[type.label, styles.statUnit]}>{unit}</Text>}
    </View>
    {!!caption && <Text style={type.small}>{caption}</Text>}
  </View>;
}

/** Stat blocks side by side (three by default). `boxed` puts each in its own card; otherwise
 * they share the parent card and are split by Line dividers. */
export function StatRow({ items, boxed = false, size }: { items: StatBlockProps[]; boxed?: boolean; size?: number }) {
  return <View style={[styles.statRow, boxed && styles.statRowBoxed]}>
    {items.map((item, index) => <View key={item.label}
      style={boxed ? [styles.card, styles.statCell, styles.statCellBoxed] : [styles.statCell, index > 0 && styles.statDivider]}>
      <StatBlock size={size} {...item} />
    </View>)}
  </View>;
}

// ---- Layout -----------------------------------------------------------------------------
export function Loading({ label }: { label?: string }) {
  return <View style={styles.loading}>
    <ActivityIndicator color={colors.accent} />
    {!!label && <Text style={type.body}>{label}</Text>}
  </View>;
}

/** A full screen on Ink, clear of the notch and home indicator. */
export function Screen({ children, scroll = true, onRefresh, refreshing = false }: {
  children: React.ReactNode;
  scroll?: boolean;
  /** Pull down to reload. */
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const insets = useSafeAreaInsets();
  if (!scroll) {
    return <View style={[styles.root, styles.fixed, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}>{children}</View>;
  }
  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent}
        colors={[colors.accentText]} progressBackgroundColor={colors.accent} /> : undefined}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}>{children}</ScrollView>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  fixed: { paddingHorizontal: 16 },
  content: { flexGrow: 1, paddingHorizontal: 16 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, marginBottom: 20, paddingHorizontal: 4 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hero: { alignItems: 'center', marginTop: 12, marginBottom: 24 },
  tagline: { marginTop: 12, marginBottom: 28 },
  center: { textAlign: 'center' },
  heroSubtitle: { marginTop: 10 },
  heading: { marginBottom: 20, gap: 8 },
  field: { marginBottom: 16, gap: 8 },
  fieldLabel: { fontFamily: fonts.bodyStrong, color: colors.text, fontSize: 14 },
  input: { backgroundColor: colors.panel, borderRadius: 16, paddingHorizontal: 16, minHeight: 52,
    fontFamily: fonts.body, fontSize: 16, color: colors.text, borderColor: colors.panelBorder, borderWidth: 1 },
  inputMultiline: { minHeight: 88, paddingTop: 14, paddingBottom: 14, textAlignVertical: 'top' },
  inputFocused: { borderColor: colors.accent },
  action: { minHeight: 52, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24, paddingVertical: 8, marginTop: 10, borderRadius: 999, gap: 8, flexDirection: 'row' },
  actionCompact: { minHeight: 44, paddingHorizontal: 18, marginTop: 0 },
  secondary: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.text },
  dangerAction: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.danger },
  ghost: { backgroundColor: 'transparent' },
  pressed: { opacity: 0.7, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.5 },
  actionText: { fontFamily: fonts.bodyStrong, fontSize: 15, textAlign: 'center', flexShrink: 1 },
  iconButton: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.panelBorder, alignItems: 'center', justifyContent: 'center' },
  iconButtonActive: { borderColor: colors.accent },
  card: { backgroundColor: colors.panel, borderColor: colors.panelBorder, borderWidth: 1, borderRadius: 22, padding: 18, gap: 10, marginBottom: 14 },
  cardSelected: { borderColor: colors.accent },
  error: { flexDirection: 'row', gap: 10, padding: 14, backgroundColor: colors.dangerBg, borderColor: colors.danger, borderWidth: 1, borderRadius: 16, marginVertical: 12 },
  errorIcon: { marginTop: 1 },
  errorText: { flex: 1, fontFamily: fonts.body, color: colors.danger, fontSize: 14, lineHeight: 21 },
  notice: { flexDirection: 'row' },
  noticeText: { flex: 1, color: colors.text },
  statBlock: { gap: 6 },
  statCenter: { alignItems: 'center' },
  statValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  statUnit: { fontSize: 10 },
  statRow: { flexDirection: 'row' },
  statRowBoxed: { gap: 10, marginBottom: 14 },
  statCell: { flex: 1, paddingHorizontal: 12 },
  statCellBoxed: { marginBottom: 0, paddingHorizontal: 14, paddingVertical: 14 },
  statDivider: { borderLeftWidth: 1, borderLeftColor: colors.panelBorder },
});
