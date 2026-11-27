import React, { useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../src/auth/session';
import { Action, AuthHero, Card, ErrorNotice, Heading, Screen } from '../src/components/Ui';
import { colors } from '../src/theme';
import { type } from '../src/typography';

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

  return <Screen>
    <AuthHero title="Your data, your choice" subtitle="Review what VantraRun records and sends before you continue." />
    <Card>
      <Heading size={16}>Runs you record in VantraRun</Heading>
      <Text style={styles.body}>When you start a run, VantraRun uses your location to measure distance and pace, and your heart rate if you connect a sensor. The finished run (route, distance, time, splits, heart-rate summary) is saved to your VantraRun account. Location is used only while a run is being recorded.</Text>
      <Heading size={16}>Importing from your phone's health services</Heading>
      <Text style={styles.body}>VantraRun can import runs from your phone's health services, but only after you separately grant the operating system's health permissions.</Text>
      <Heading size={16}>What could be sent</Heading>
      <Text style={styles.body}>Activity details may include workout names, exercises, sets, weights, run distance, duration, heart rate, route coordinates and other fields VantraRun supports.</Text>
      <Heading size={16}>Where it goes</Heading>
      <Text style={styles.body}>When you choose to import, the activities you select are sent to your VantraRun account. VantraRun uses no advertising or analytics software.</Text>
      <Heading size={16}>You remain in control</Heading>
      <Text style={styles.body}>Apple Health permissions are requested separately, only after you agree here, your invite is confirmed and you choose Apple Health. You can withdraw this consent later. Withdrawing does not delete records already uploaded to VantraRun or end a server session.</Text>
    </Card>
    <ErrorNotice message={error ?? sessionError} />
    <Action label="I understand and agree" onPress={accept} busy={busy} />
    <Action label="Not now, sign out" onPress={decline} busy={busy} secondary />
    <Text style={[type.small, styles.note]}>Your decision is stored securely on this phone for the current sign-in. Every new sign-in asks again.</Text>
  </Screen>;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { ...type.body, marginBottom: 8 },
  note: { textAlign: 'center', marginTop: 16, paddingHorizontal: 12 },
});
