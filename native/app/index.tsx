import React, { useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { login, resendSmsMfa, verifyMfa, type MfaChallenge, type MfaMethod } from '../src/auth/auth-api';
import { useSession } from '../src/auth/session';
import { Action, AuthHero, Card, ErrorNotice, Field, Screen } from '../src/components/Ui';
import { colors } from '../src/theme';
import { type } from '../src/typography';

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
          setError('Your account needs two-step sign-in set up before you can sign in here. Set it up on the VantraRun website, then come back.');
        } else if (result.challenge.methods.length === 0) {
          setError('Two-step sign-in is required, but your account has no authenticator or SMS method this app supports.');
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
    <Screen>
      <AuthHero title={challenge ? 'Verify it is you' : 'Welcome back'}
        subtitle={challenge ? 'Enter the code from your second sign-in step.' : 'Sign in to your account.'} />
      <ErrorNotice message={error ?? sessionError} />
      <Card style={styles.card}>
        {!challenge ? (
          <>
            <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" placeholder="you@example.com" />
            <Field label="Password" value={password} onChangeText={setPassword} secure />
            <Action label="Sign in" onPress={attemptLogin} busy={busy} disabled={!email.trim() || !password} />
            <Action label="Create an account with an invite code" onPress={() => router.push('/signup')} variant="ghost" />
          </>
        ) : (
          <>
            <Text style={type.body}>Sign-in method: {challenge.methods.join(' or ') || 'unavailable'}</Text>
            {challenge.methods.includes('totp') && <Action label="Use authenticator code" onPress={() => setMethod('totp')} secondary={method !== 'totp'} />}
            {challenge.methods.includes('sms') && <Action label="Use SMS code" onPress={() => setMethod('sms')} secondary={method !== 'sms'} />}
            <Field label="Six-digit code" value={code} onChangeText={setCode} keyboardType="number-pad" />
            <Action label="Verify and continue" onPress={attemptMfa} busy={busy} disabled={unsupportedMfa || code.trim().length < 6} />
            {method === 'sms' && challenge.methods.includes('sms') &&
              <Action label="Send a new SMS code" secondary onPress={resendSms} busy={busy} disabled={unsupportedMfa} />}
            <Action label="Start over" variant="ghost" onPress={() => { setChallenge(null); setError(null); setCode(''); }} />
          </>
        )}
      </Card>
      {!challenge && <Text style={[type.small, styles.note]}>VantraRun is invite-only for now. Sign in with your email and password, or create an account with the code you were given.</Text>}
      <Text style={[type.small, styles.note]}>Your sign-in is kept in secure storage on this phone. No tracking.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { paddingTop: 22, paddingBottom: 14 },
  note: { textAlign: 'center', marginTop: 10, paddingHorizontal: 12 },
});
