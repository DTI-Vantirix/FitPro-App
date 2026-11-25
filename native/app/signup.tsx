import React, { useState } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from 'react-native';
import { useSession } from '../src/auth/session';
import { Action, ErrorNotice, Field, SectionHeading } from '../src/components/Ui';
import { ApiError, register, resendEmailCode, verifyEmailCode } from '../src/run/api';
import { Brand, Loading, Note, Screen, styles } from '../src/run/ui/Screen';

/** Create an account with the owner's invite code, then confirm the emailed 6-digit code.
 * No health, location or Bluetooth permission is asked for here. */
export default function SignUp() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; verify?: string }>();
  const { accessToken, loadingSession, saveSession } = useSession();
  const [step, setStep] = useState<'details' | 'code'>(params.verify === '1' && params.email ? 'code' : 'details');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [codeTaken, setCodeTaken] = useState(false);

  if (loadingSession) return <Loading />;
  if (accessToken) return <Redirect href="/consent" />;

  async function attempt(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409 && step === 'code') setCodeTaken(true);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const createAccount = () => attempt(async () => {
    await register({ email, password, fullName, inviteCode });
    setPassword('');
    setCode('');
    setCodeTaken(false);
    setStep('code');
  });

  const confirm = () => attempt(async () => {
    const token = await verifyEmailCode(email, code);
    await saveSession(token);
    router.replace('/consent');
  });

  const resend = () => attempt(async () => {
    await resendEmailCode(email);
    setNotice('If that address is waiting to be confirmed, a new code is on its way.');
  });

  const detailsReady = email.trim().includes('@') && password.length >= 8 && inviteCode.trim().length > 0;

  return <Screen>
    <Brand />
    {step === 'details' ? <>
      <SectionHeading kicker="NEW HERE" title="Create your account."
        subtitle="FitPro is invite-only for now. You need the code you were given." />
      <ErrorNotice message={error} />
      <Field label="NAME" value={fullName} onChangeText={setFullName} autoCapitalize="sentences" />
      <Field label="EMAIL" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <Field label="PASSWORD (8 OR MORE CHARACTERS)" value={password} onChangeText={setPassword} secure />
      <Field label="INVITE CODE" value={inviteCode} onChangeText={setInviteCode} />
      <Action label="Create account" onPress={() => { void createAccount(); }} busy={busy} disabled={!detailsReady} />
      <Action label="I already have an account" onPress={() => router.replace('/')} secondary />
      <Note>We email you a 6-digit code to confirm the address. Your invite code is used up only once you enter it.</Note>
    </> : <>
      <SectionHeading kicker="CHECK YOUR EMAIL" title="Enter the 6-digit code."
        subtitle={`We sent it to ${email.trim() || 'your email address'}.`} />
      <ErrorNotice message={error} />
      {!!notice && <Text style={styles.body}>{notice}</Text>}
      <Field label="SIX-DIGIT CODE" value={code} onChangeText={setCode} keyboardType="number-pad" />
      <Action label="Confirm and continue" onPress={() => { void confirm(); }} busy={busy} disabled={code.trim().length < 6} />
      <Action label="Send a new code" onPress={() => { void resend(); }} busy={busy} secondary />
      {codeTaken && <Action label="Use a different invite code" secondary
        onPress={() => { setStep('details'); setInviteCode(''); setError(null); setCodeTaken(false); }} />}
      <Action label="Start over" secondary onPress={() => { setStep('details'); setError(null); setNotice(null); }} />
    </>}
  </Screen>;
}
