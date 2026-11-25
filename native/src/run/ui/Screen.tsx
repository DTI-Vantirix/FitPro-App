/** Layout and access gate shared by the run screens. */
import React from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../../auth/session';
import { useAccessGate } from '../../access/access-gate';
import { Action, ErrorNotice } from '../../components/Ui';
import { colors } from '../../theme';
import { useRunAccount } from '../use-run';

export function Loading({ label }: { label?: string }) {
  return <View style={styles.loading}>
    <ActivityIndicator color={colors.accent} />
    {!!label && <Text style={styles.muted}>{label}</Text>}
  </View>;
}

export function Screen({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  if (!scroll) return <View style={[styles.root, styles.fixed]}>{children}</View>;
  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>{children}</ScrollView>
  </KeyboardAvoidingView>;
}

export function Brand() {
  return <Text style={styles.brand}>FITPRO</Text>;
}

export function Panel({ children }: { children: React.ReactNode }) {
  return <View style={styles.panel}>{children}</View>;
}

export function Note({ children }: { children: React.ReactNode }) {
  return <Text style={styles.note}>{children}</Text>;
}

/** Everything behind sign-in, consent and an accepted invite — the same three checks, in
 * the same order, as the health-import screens. `setup` also requires zones and a max
 * heart rate, sending a new runner to first-time setup. */
export function Gated({ children, setup = true }: { children: React.ReactNode; setup?: boolean }) {
  const { accessToken, loadingSession, consentAccepted } = useSession();
  const { status, error, refresh } = useAccessGate();
  const account = useRunAccount();

  if (loadingSession) return <Loading />;
  if (!accessToken) return <Redirect href="/" />;
  if (!consentAccepted) return <Redirect href="/consent" />;
  if (status === 'needs_invite' || status === 'blocked') return <Redirect href="/invite" />;
  if (status === 'checking') return <Loading label="Checking your access…" />;
  if (status === 'error' && !account.offlineAccess) {
    return <Screen>
      <Brand />
      <ErrorNotice message={error ?? 'FitPro could not confirm your access.'} />
      <Note>Your access could not be checked, so nothing is shown. Check your connection and try again. (Once you have opened FitPro with a connection on this phone, you can start a run without one.)</Note>
      <Action label="Try again" onPress={() => { void refresh(); }} />
    </Screen>;
  }
  if (account.status === 'loading' || account.status === 'blocked') return <Loading label="Loading your account…" />;
  if (account.status === 'offline') {
    return <Screen>
      <Brand />
      <ErrorNotice message={account.error} />
      <Note>FitPro needs a connection the first time you open it on this phone. After that you can start a run without one.</Note>
      <Action label="Try again" onPress={() => { void account.reload(); }} />
    </Screen>;
  }
  if (setup && account.setupNeeded === true) return <Redirect href="/setup" />;
  if (setup && account.setupNeeded === null) {
    return <Screen>
      <Brand />
      <ErrorNotice message={account.error} />
      <Note>Your zones could not be loaded. Check your connection and try again.</Note>
      <Action label="Try again" onPress={() => { void account.reload(); }} />
    </Screen>;
  }
  return <>{children}</>;
}

export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  fixed: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20 },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 36, paddingBottom: 60 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.background },
  brand: { color: colors.text, fontWeight: '900', letterSpacing: 3, fontSize: 14, marginBottom: 28 },
  panel: { backgroundColor: colors.panel, borderColor: colors.panelBorder, borderWidth: 1, borderRadius: 14, padding: 16, gap: 8, marginBottom: 16 },
  note: { color: colors.subtle, lineHeight: 19, marginTop: 10, marginBottom: 6, fontSize: 12 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  label: { color: colors.accent, letterSpacing: 1.5, fontSize: 11, fontWeight: '800' },
  title: { color: colors.text, fontSize: 18, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
});
