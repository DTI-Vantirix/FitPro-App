import React, { useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../src/auth/session';
import { useAccessGate } from '../src/access/access-gate';
import { Action, AuthHero, Card, ErrorNotice, Field, Screen } from '../src/components/Ui';
import { colors } from '../src/theme';
import { type } from '../src/typography';

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

  return <Screen>
    <AuthHero title="Verify your invite" subtitle="VantraRun is invite-only. Your account is checked before a new code is asked for." />
    {status === 'checking' ? (
      <Card style={styles.loadingPanel}>
        <ActivityIndicator color={colors.accent} />
        <Text style={type.body}>Checking your invite…</Text>
      </Card>
    ) : <>
      <ErrorNotice message={error ?? accessError ?? sessionError} />
      {status === 'error' ? (
        <>
          <Text style={[type.body, styles.lead]}>VantraRun could not check your access, so you cannot continue yet. Check your connection and try again.</Text>
          <Action label="Try again" onPress={retry} busy={busy} />
        </>
      ) : (
        <Card>
          <Text style={type.body}>Enter the single-use invite code you were given. An account that is already approved passes this step automatically.</Text>
          <Field label="Invite code" value={code} onChangeText={setCode} />
          <Action label="Redeem invite and continue" onPress={redeemCode} busy={busy} disabled={!code.trim()} />
          <Action label="Check access again" onPress={retry} busy={busy} variant="ghost" />
        </Card>
      )}
    </>}
    <Action label="Sign out" onPress={signOut} busy={busy} secondary />
    <Text style={[type.small, styles.note]}>Codes are checked by VantraRun itself. This app never grants access on its own.</Text>
  </Screen>;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingPanel: { alignItems: 'center', paddingVertical: 26, gap: 14 },
  lead: { marginBottom: 8 },
  note: { textAlign: 'center', marginTop: 16, paddingHorizontal: 12 },
});
