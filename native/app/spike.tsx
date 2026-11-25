import React, { useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../src/auth/session';
import { useAccessGate } from '../src/access/access-gate';
import { Action, ErrorNotice, SectionHeading } from '../src/components/Ui';
import { sendSyntheticWorkout, type IngestResult } from '../src/ingestion/ingest-api';
import { SPIKE_EXTERNAL_ID } from '../src/ingestion/spike-workout';
import { INGEST_URL } from '../src/config';
import { colors } from '../src/theme';

export default function IngestSpike() {
  const router = useRouter();
  const { accessToken, loadingSession, consentAccepted, sessionError, forgetSession, withdrawConsent } = useSession();
  const { status: accessStatus, error: accessError, refresh } = useAccessGate();
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loadingSession) return <View style={styles.loading}><ActivityIndicator color={colors.accent} /></View>;
  if (!accessToken) return <Redirect href="/" />;
  if (!consentAccepted) return <Redirect href="/consent" />;
  if (accessStatus === 'checking') return <View style={styles.loading}><ActivityIndicator color={colors.accent} /></View>;
  if (accessStatus === 'needs_invite' || accessStatus === 'blocked') return <Redirect href="/invite" />;

  async function runTest() {
    if (accessStatus !== 'allowed') {
      setError('Invite access not approved. Cannot send a test workout.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const reply = await sendSyntheticWorkout(accessToken!);
      setResult(reply);
      if (!reply.ok) setError(`Request failed: HTTP ${reply.status}. Raw response below.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    setBusy(true);
    setError(null);
    try {
      await withdrawConsent();
      router.replace('/consent');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function forgetDevice() {
    setBusy(true);
    setError(null);
    try {
      await forgetSession();
      router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return <ScrollView style={styles.root} contentContainerStyle={styles.content}>
    <Text style={styles.brand}>FITPRO / NATIVE</Text>
    {accessStatus === 'error' ? <>
      <SectionHeading kicker="STEP 02 · INVITE VERIFICATION" title="Access check failed."
        subtitle="Activity ingestion remains locked while inviteAccess cannot confirm your account." />
      <ErrorNotice message={accessError} />
      <Action label="Retry invite verification" onPress={() => { void refresh(); }} secondary />
      <Action label="Back to invite screen" onPress={() => router.replace('/invite')} secondary />
    </> : <>
    <SectionHeading kicker="STEP 01 · BACKEND SPIKE" title="Connection test."
      subtitle="Signed-in user token is in secure device storage. It is not displayed or shipped in app code." />
    <View style={styles.panel}>
      <Text style={styles.panelLabel}>ACCESS</Text>
      <Text style={styles.small}>Consent accepted · Invite access confirmed by the FitPro API</Text>
      <Text style={styles.panelLabel}>TARGET</Text>
      <Text selectable style={styles.small}>{INGEST_URL}</Text>
      <Text style={styles.panelLabel}>TEST WORKOUT ID</Text>
      <Text selectable style={styles.small}>{SPIKE_EXTERNAL_ID}</Text>
      <Text style={styles.panelLabel}>DATA</Text>
      <Text style={styles.small}>Synthetic bodyweight squat · 1 set · 5 reps · weight 0</Text>
    </View>
    <Action label={busy ? 'Sending…' : 'Send synthetic test workout'} onPress={runTest} busy={busy} disabled={accessStatus !== 'allowed'} />
    <Text style={styles.note}>The button writes one synthetic workout to your real FitPro backend. Press it again to test created → updated deduplication. It does not read any health data.</Text>
    <ErrorNotice message={error ?? sessionError} />
    {result && <View style={styles.result}>
      <Text style={styles.panelLabel}>HTTP STATUS</Text>
      <Text style={styles.status}>{result.status} · {result.ok ? 'SUCCESS' : 'ERROR'}</Text>
      <Text style={styles.panelLabel}>DEDUPE ACTION</Text>
      <Text style={styles.status}>{result.action ?? 'Not returned'}</Text>
      <Text style={styles.panelLabel}>RAW SERVER RESPONSE</Text>
      <Text selectable style={styles.response}>{result.rawResponse || '(empty response)'}</Text>
    </View>}
    </>}
    {accessStatus === 'allowed' && <Action label="View activities · Fake / Apple Health" onPress={() => router.push('/activities')} secondary />}
    <Action label="Withdraw local health import consent" secondary onPress={withdraw} busy={busy} />
    <Text style={styles.note}>Withdrawn consent blocks the native ingestion screen. It does not delete existing FitPro activity records.</Text>
    <Action label="Forget stored session on this device" secondary onPress={forgetDevice} busy={busy} />
    <Text style={styles.note}>This removes the local token. It is not a server-side session revocation.</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingTop: 40, paddingBottom: 65 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  brand: { color: colors.text, fontWeight: '900', letterSpacing: 3, fontSize: 14, marginBottom: 42 },
  panel: { backgroundColor: colors.panel, borderColor: colors.panelBorder, borderWidth: 1, borderRadius: 14, padding: 18, gap: 7 },
  panelLabel: { color: colors.accent, letterSpacing: 1.5, fontSize: 11, fontWeight: '800', marginTop: 8 },
  small: { color: colors.muted, lineHeight: 19, fontSize: 12 },
  note: { color: colors.subtle, lineHeight: 19, marginTop: 14, marginBottom: 16, fontSize: 12 },
  result: { backgroundColor: colors.panel, borderColor: colors.panelBorder, borderWidth: 1, borderRadius: 14, padding: 18, gap: 9, marginBottom: 18 },
  status: { color: colors.text, fontSize: 15, fontWeight: '800' },
  response: { color: colors.text, fontSize: 12, fontFamily: 'monospace', lineHeight: 20, marginTop: 4 },
});
