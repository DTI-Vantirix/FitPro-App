import React, { useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../src/auth/session';
import { useAccessGate } from '../src/access/access-gate';
import { Action, ErrorNotice, Field, SectionHeading } from '../src/components/Ui';
import { colors } from '../src/theme';

export default function InviteScreen() {
  const router = useRouter();
  const { accessToken, loadingSession, consentAccepted, forgetSession, sessionError } = useSession();
  const { status, error: accessError, refresh, redeem } = useAccessGate();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loadingSession) return <View style={styles.loading}><ActivityIndicator color={colors.accent} /></View>;
  if (!accessToken) return <Redirect href="/" />;
  if (!consentAccepted) return <Redirect href="/consent" />;
  if (status === 'allowed') return <Redirect href="/home" />;

  async function redeemCode() {
    setBusy(true);
    setError(null);
    try {
      await redeem(code);
      setCode('');
      router.replace('/home');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    setBusy(true);
    setError(null);
    try { await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true);
    setError(null);
    try {
      await forgetSession();
      router.replace('/');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <Text style={styles.brand}>FITPRO / NATIVE</Text>
      <SectionHeading kicker="STEP 02 · INVITE ACCESS" title="Verify your invite."
        subtitle="FitPro is invite-only. We'll check your existing account access before accepting a new code." />
      {status === 'checking' ? (
        <View style={styles.loadingPanel}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.muted}>Checking FitPro invite access…</Text>
        </View>
      ) : <>
        <ErrorNotice message={error ?? accessError ?? sessionError} />
        {status === 'error' ? (
          <>
            <Text style={styles.muted}>FitPro could not verify access. You are not authorized to continue while this request is failing.</Text>
            <Action label="Retry access check" onPress={retry} busy={busy} />
          </>
        ) : (
          <>
            <Text style={styles.muted}>Enter the single-use invite code provided by the FitPro administrator. An existing approved account should pass this step automatically.</Text>
            <Field label="FITPRO INVITE CODE" value={code} onChangeText={setCode} />
            <Action label="Redeem invite and continue" onPress={redeemCode} busy={busy} disabled={!code.trim()} />
            <Action label="Check access again" onPress={retry} busy={busy} secondary />
          </>
        )}
      </>}
      <Action label="Sign out" onPress={signOut} busy={busy} secondary />
      <Text style={styles.note}>Codes are verified directly by the FitPro API's inviteAccess function. This native client never creates access grants itself.</Text>
    </ScrollView>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 42, paddingBottom: 60 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  brand: { color: colors.text, fontWeight: '900', letterSpacing: 3, fontSize: 14, marginBottom: 36 },
  loadingPanel: { backgroundColor: colors.panel, borderRadius: 14, padding: 25, gap: 14, alignItems: 'center' },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 22, marginBottom: 18 },
  note: { color: colors.subtle, lineHeight: 19, marginTop: 20, fontSize: 12 },
});
