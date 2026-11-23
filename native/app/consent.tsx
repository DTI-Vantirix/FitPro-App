import React, { useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../src/auth/session';
import { Action, ErrorNotice, SectionHeading } from '../src/components/Ui';
import { colors } from '../src/theme';

export default function ConsentScreen() {
  const router = useRouter();
  const { accessToken, loadingSession, consentAccepted, acceptConsent, forgetSession, sessionError } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loadingSession) return <View style={styles.loading}><ActivityIndicator color={colors.accent} /></View>;
  if (!accessToken) return <Redirect href="/" />;
  if (consentAccepted) return <Redirect href="/invite" />;

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await acceptConsent();
      router.replace('/invite');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function decline() {
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

  return <ScrollView style={styles.root} contentContainerStyle={styles.content}>
    <Text style={styles.brand}>FITPRO / NATIVE</Text>
    <SectionHeading kicker="STEP 02 · YOUR CHOICE" title="Your health data. Your choice."
      subtitle="Review what future activity imports would involve before you choose to continue." />
    <View style={styles.panel}>
      <Text style={styles.title}>What you would authorize</Text>
      <Text style={styles.body}>FitPro may import your workouts and runs from your phone's health services after you separately grant the operating system's health permissions in a future step.</Text>
      <Text style={styles.title}>What could be sent</Text>
      <Text style={styles.body}>Activity details may include workout names, exercises, sets, weights, run distance, duration, heart rate, route coordinates and other fields supported by the FitPro ingestion contract.</Text>
      <Text style={styles.title}>Where it would go</Text>
      <Text style={styles.body}>When you choose to sync, selected activity data will be sent to your existing FitPro account through the FitPro API. This shell uses no advertising or analytics SDKs.</Text>
      <Text style={styles.title}>You remain in control</Text>
      <Text style={styles.body}>Apple Health permissions are requested separately, only after your consent and invite authorization have passed and you explicitly select Apple Health. You can withdraw this local consent later. Withdrawing does not delete records already uploaded to FitPro or revoke a server session.</Text>
    </View>
    <ErrorNotice message={error ?? sessionError} />
    <Action label="I understand and agree to continue" onPress={accept} busy={busy} />
    <Action label="Not now — sign out" onPress={decline} busy={busy} secondary />
    <Text style={styles.note}>Your decision is stored securely on this device for the current signed-in session. Every new login asks again.</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 24, paddingTop: 42, paddingBottom: 60 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  brand: { color: colors.text, fontWeight: '900', letterSpacing: 3, fontSize: 14, marginBottom: 36 },
  panel: { backgroundColor: colors.panel, borderColor: colors.panelBorder, borderWidth: 1, borderRadius: 14, padding: 18, gap: 9, marginBottom: 20 },
  title: { color: colors.accent, fontWeight: '800', fontSize: 14, marginTop: 7 },
  body: { color: colors.muted, lineHeight: 22, fontSize: 14, marginBottom: 9 },
  note: { color: colors.subtle, lineHeight: 19, marginTop: 18, fontSize: 12 },
});
