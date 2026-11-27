import React, { useState } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from '../src/auth/session';
import { Action, AuthHero, Card, ErrorNotice, Field, Notice } from '../src/components/Ui';
import { ApiError, register, resendEmailCode, verifyEmailCode } from '../src/run/api';
import { Loading, Note, Screen } from '../src/run/ui/Screen';

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
  // The server confirms an email only together with the password its owner chose. Coming
  // from sign-up that password is still in memory; coming from sign-in (an account that
  // signed in before confirming) it is not, so the code step asks for it.
  const [passwordInHand, setPasswordInHand] = useState(false);

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
    // The password stays in memory until the code is confirmed: it is sent again with the code.
    setCode('');
    setCodeTaken(false);
    setPasswordInHand(true);
    setStep('code');
  });

  const confirm = () => attempt(async () => {
    const token = await verifyEmailCode(email, code, password);
    setPassword('');
    await saveSession(token);
    router.replace('/consent');
  });

  const resend = () => attempt(async () => {
    await resendEmailCode(email);
    setNotice('If that address is waiting to be confirmed, a new code is on its way. If you asked less than a minute ago, use the code you already have.');
  });

  const detailsReady = email.trim().includes('@') && password.length >= 8 && inviteCode.trim().length > 0;

  return <Screen>
    {step === 'details' ? <>
      <AuthHero title="Create your account" subtitle="VantraRun is invite-only for now. You need the code you were given." />
      <ErrorNotice message={error} />
      <Card>
        <Field label="Name" value={fullName} onChangeText={setFullName} autoCapitalize="sentences" />
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" placeholder="you@example.com" />
        <Field label="Password (8 or more characters)" value={password} onChangeText={setPassword} secure />
        <Field label="Invite code" value={inviteCode} onChangeText={setInviteCode} />
        <Action label="Create account" onPress={() => { void createAccount(); }} busy={busy} disabled={!detailsReady} />
        <Action label="I already have an account" onPress={() => router.replace('/')} variant="ghost" />
      </Card>
      <Note>We email you a 6-digit code to confirm the address. Your invite code is used up only once you enter it.</Note>
    </> : <>
      <AuthHero title="Check your email" subtitle={`Enter the 6-digit code we sent to ${email.trim() || 'your email address'}.`} />
      <ErrorNotice message={error} />
      {!!notice && <Notice>{notice}</Notice>}
      <Card>
        {!passwordInHand && <>
          <Field label="Password" value={password} onChangeText={setPassword} secure />
          <Note>Enter the password you chose when you signed up.</Note>
        </>}
        <Field label="Six-digit code" value={code} onChangeText={setCode} keyboardType="number-pad" />
        <Action label="Confirm and continue" onPress={() => { void confirm(); }} busy={busy}
          disabled={code.trim().length < 6 || (!passwordInHand && password.length < 8)} />
        <Action label="Send a new code" onPress={() => { void resend(); }} busy={busy} secondary />
        {codeTaken && <Action label="Use a different invite code" secondary
          onPress={() => { setStep('details'); setInviteCode(''); setError(null); setCodeTaken(false); }} />}
        <Action label="Start over" variant="ghost" onPress={() => { setStep('details'); setError(null); setNotice(null); }} />
      </Card>
    </>}
  </Screen>;
}
