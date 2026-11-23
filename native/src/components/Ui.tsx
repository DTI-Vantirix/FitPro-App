import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../theme';

export function SectionHeading({ kicker, title, subtitle }: { kicker: string; title: string; subtitle: string }) {
  return <View style={styles.heading}>
    <Text style={styles.kicker}>{kicker}</Text>
    <Text style={styles.title}>{title}</Text>
    <Text style={styles.subtitle}>{subtitle}</Text>
  </View>;
}

export function Field({ label, value, onChangeText, secure = false, keyboardType = 'default', autoCapitalize = 'none' }: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  secure?: boolean;
  keyboardType?: 'default' | 'email-address' | 'number-pad';
  autoCapitalize?: 'none' | 'sentences';
}) {
  return <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput
      accessibilityLabel={label}
      value={value}
      onChangeText={onChangeText}
      placeholderTextColor={colors.subtle}
      autoCapitalize={autoCapitalize}
      autoCorrect={false}
      secureTextEntry={secure}
      keyboardType={keyboardType}
      style={styles.input}
    />
  </View>;
}

export function Action({ label, onPress, busy = false, disabled = false, secondary = false }: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || disabled, busy }}
    disabled={busy || disabled} onPress={onPress}
    style={({ pressed }) => [
      styles.action,
      secondary && styles.secondary,
      pressed && !(busy || disabled) && styles.pressed,
      (busy || disabled) && styles.disabled,
    ]}>
    {busy && <ActivityIndicator color={secondary ? colors.accent : colors.accentText} />}
    <Text style={[styles.actionText, secondary && styles.secondaryText]}>{label}</Text>
  </Pressable>;
}

export function ErrorNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return <View accessibilityRole="alert" style={styles.error}><Text selectable style={styles.errorText}>{message}</Text></View>;
}

const styles = StyleSheet.create({
  heading: { marginBottom: 28, gap: 8 },
  kicker: { color: colors.accent, fontSize: 12, letterSpacing: 2, fontWeight: '800' },
  title: { fontSize: 32, color: colors.text, letterSpacing: -0.8, fontWeight: '800' },
  subtitle: { fontSize: 15, color: colors.muted, lineHeight: 22 },
  field: { marginBottom: 16, gap: 7 },
  fieldLabel: { color: colors.muted, fontWeight: '700', fontSize: 13 },
  input: { backgroundColor: colors.panel, borderRadius: 12, paddingHorizontal: 14, minHeight: 52,
    fontSize: 16, color: colors.text, borderColor: colors.panelBorder, borderWidth: 1 },
  action: { minHeight: 54, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 16, marginTop: 8, borderRadius: 14, gap: 8, flexDirection: 'row' },
  secondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.panelBorder },
  pressed: { opacity: 0.68, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.5 },
  actionText: { fontSize: 15, fontWeight: '800', color: colors.accentText },
  secondaryText: { color: colors.text },
  error: { padding: 14, backgroundColor: colors.dangerBg, borderRadius: 12, marginVertical: 12 },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 21 },
});
