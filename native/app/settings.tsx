import React, { useState } from 'react';
import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { useSession } from '../src/auth/session';
import { Action, ErrorNotice, Field, SectionHeading } from '../src/components/Ui';
import { deleteAccount } from '../src/run/api';
import { deviceCache, runCheckpoint, runStore } from '../src/run/device/run-files';
import { removeOwnerRuns } from '../src/run/queue';
import { heartRateMonitor, setRunAuth } from '../src/run/runtime';
import { Brand, Gated, Note, Panel, Screen, styles } from '../src/run/ui/Screen';
import { useRun, useRunAccount, useWaitingRuns } from '../src/run/use-run';

function Settings() {
  const router = useRouter();
  const { accessToken, forgetSession } = useSession();
  const account = useRunAccount();
  const run = useRun();
  const waiting = useWaitingRuns();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const unsent = waiting.pending + waiting.needsAttention;

  async function signOut() {
    setBusy(true);
    setError(null);
    try {
      await heartRateMonitor.disconnect();
      await forgetSession();
      router.replace('/');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  async function removeAccount() {
    if (!accessToken || !account.ownerId) return;
    setBusy(true);
    setError(null);
    try {
      // The server goes first: if it refuses (wrong password, no connection) nothing here is touched.
      await deleteAccount(accessToken, password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
      return;
    }
    try {
      await removeOwnerRuns(runStore, account.ownerId);
      await runCheckpoint.clear(account.ownerId);
      await deviceCache.remove(`account-${account.ownerId}`);
      await deviceCache.remove(`routes-${account.ownerId}`);
      await heartRateMonitor.disconnect();
    } catch {
      // The account is gone; anything left on the phone belongs to no one and is never uploaded.
    }
    setRunAuth(null);
    await forgetSession().catch(() => {});
    router.replace('/');
  }

  return <Screen>
    <Brand />
    <SectionHeading kicker="SETTINGS" title="Your account." subtitle="Sign out, or delete your account and everything in it." />
    <ErrorNotice message={error} />
    {run && <Panel><Text style={styles.body}>A run is in progress. Finish or discard it before signing out or deleting your account.</Text></Panel>}

    <Panel>
      <Text style={styles.label}>SIGN OUT</Text>
      {unsent > 0 && <Text style={styles.body}>
        {unsent} run{unsent === 1 ? ' is' : 's are'} not on the server yet. {unsent === 1 ? 'It stays' : 'They stay'} on this phone and will be sent when you sign back in to this account.
      </Text>}
      <Action label="Sign out" onPress={() => { void signOut(); }} busy={busy} disabled={Boolean(run)} secondary />
    </Panel>

    <Panel>
      <Text style={styles.label}>DELETE ACCOUNT</Text>
      <Text style={styles.body}>Permanently deletes your VantraRun account and every run, route, zone and post it owns, on the server and on this phone. This cannot be undone.</Text>
      {!deleting
        ? <Action label="Delete my account…" onPress={() => { setDeleting(true); setError(null); }} disabled={Boolean(run)} secondary />
        : <>
          <Field label="YOUR PASSWORD" value={password} onChangeText={setPassword} secure />
          <Field label='TYPE "DELETE" TO CONFIRM' value={confirm} onChangeText={setConfirm} />
          <Action label="Delete my account permanently" onPress={() => { void removeAccount(); }} busy={busy}
            disabled={Boolean(run) || !password || confirm.trim().toUpperCase() !== 'DELETE'} />
          <Action label="Cancel" onPress={() => { setDeleting(false); setPassword(''); setConfirm(''); }} secondary />
        </>}
    </Panel>

    <Panel>
      <Text style={styles.label}>HEALTH IMPORT</Text>
      <Text style={styles.body}>Automatic import from Apple Health and Health Connect is off, so a run recorded here and on your watch is not saved twice. You can still import a run by hand.</Text>
      <Action label="Import a run by hand" onPress={() => router.push('/activities')} secondary />
    </Panel>

    <Panel>
      <Text style={styles.label}>FOR DEVELOPERS</Text>
      <Action label="Connection test" onPress={() => router.push('/spike')} secondary />
    </Panel>
    <Action label="Back" onPress={() => router.back()} secondary />
    <Note>VantraRun uses no advertising or analytics software. Zones and routes are edited on the website for now.</Note>
  </Screen>;
}

export default function SettingsScreen() {
  return <Gated setup={false}><Settings /></Gated>;
}
