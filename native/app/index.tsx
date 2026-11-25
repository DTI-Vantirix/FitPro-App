import React, { useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { login, resendSmsMfa, verifyMfa, type MfaChallenge, type MfaMethod } from '../src/auth/auth-api';
import { useSession } from '../src/auth/session';
import { Action, ErrorNotice, Field, SectionHeading } from '../src/components/Ui';
import { colors } from '../src/theme';

export default function SignIn() {
  const router = useRouter();
  const { accessToken, loadingSession, sessionError, saveSession } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [method, setMethod] = useState<MfaMethod>('totp');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loadingSession) {
    return <View style={styles.loading}><ActivityIndicator color={colors.accent} /></View>;
  }
  if (accessToken) return <Redirect href="/consent" />;

  async function attemptLogin() {
    setError(null);
    setBusy(true);
    try {
      const result = await login(email, password);
      if (result.kind === 'authenticated') {
        await saveSession(result.accessToken);
        setPassword('');
        router.replace('/consent');
      } else {
        setPassword('');
        setChallenge(result.challenge);
        setMethod(result.challenge.methods.includes('totp') ? 'totp' : 'sms');
        if (result.challenge.nextStep === 'enroll') {
          setError('The VantraRun API requires MFA enrollment. This Step 1 shell does not enroll new factors. Finish enrollment in the VantraRun web app, then return here.');
        } else if (result.challenge.methods.length === 0) {
          setError('MFA required but no supported totp/sms method was returned. Stop.');
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // The account exists but its email was never confirmed: the server has just sent a new code.
      if (/HTTP 403: Verify your email/.test(message)) {
        setPassword('');
        router.push({ pathname: '/signup', params: { email: email.trim(), verify: '1' } });
        return;
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function attemptMfa() {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      const token = await verifyMfa(challenge, method, code);
      await saveSession(token);
      setChallenge(null);
      setCode('');
      router.replace('/consent');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function resendSms() {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      await resendSmsMfa(challenge);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const unsupportedMfa = challenge?.nextStep === 'enroll' || challenge?.methods.length === 0;
  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Text style={styles.brand}>VANTRARUN</Text>
        <View style={styles.topRule} />
        <SectionHeading kicker="SIGN IN" title={challenge ? 'Verify your identity' : 'Welcome back.'}
          subtitle={challenge ? 'Complete the same multi-factor login used by the VantraRun web app.'
            : 'Sign into your VantraRun account.'} />
        <ErrorNotice message={error ?? sessionError} />
        {!challenge ? (
          <>
            <Field label="EMAIL" value={email} onChangeText={setEmail} keyboardType="email-address" />
            <Field label="PASSWORD" value={password} onChangeText={setPassword} secure />
            <Action label="Sign into VantraRun" onPress={attemptLogin} busy={busy} disabled={!email.trim() || !password} />
            <Action label="Create an account with an invite code" onPress={() => router.push('/signup')} secondary />
            <Text style={styles.note}>VantraRun is invite-only for now. Sign in with your email and password, or create an account with the code you were given.</Text>
          </>
        ) : (
          <>
            <Text style={styles.note}>Required MFA method: {challenge.methods.join(' or ') || 'unavailable'}</Text>
            {challenge.methods.includes('totp') && <Action label="Use authenticator code" onPress={() => setMethod('totp')} secondary={method !== 'totp'} />}
            {challenge.methods.includes('sms') && <Action label="Use SMS code" onPress={() => setMethod('sms')} secondary={method !== 'sms'} />}
            <Field label="SIX-DIGIT CODE" value={code} onChangeText={setCode} keyboardType="number-pad" />
            <Action label="Verify and continue" onPress={attemptMfa} busy={busy} disabled={unsupportedMfa || code.trim().length < 6} />
            {method === 'sms' && challenge.methods.includes('sms') &&
              <Action label="Send / resend SMS code" secondary onPress={resendSms} busy={busy} disabled={unsupportedMfa} />}
            <Action label="Start over" secondary onPress={() => { setChallenge(null); setError(null); setCode(''); }} />
          </>
        )}
        <Text style={styles.footer}>AUTH SESSION · EXPO SECURE STORE · NO TRACKING</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, padding: 25, paddingTop: 85, paddingBottom: 45 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  brand: { color: colors.text, fontWeight: '900', letterSpacing: 3, fontSize: 14 },
  topRule: { width: 48, backgroundColor: colors.accent, height: 3, marginTop: 18, marginBottom: 50 },
  note: { marginTop: 20, color: colors.muted, lineHeight: 21, fontSize: 13 },
  footer: { marginTop: 55, fontSize: 10, letterSpacing: 1.5, color: colors.subtle, textAlign: 'center' },
});
