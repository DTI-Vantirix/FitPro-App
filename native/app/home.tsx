import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Action, ErrorNotice, SectionHeading } from '../src/components/Ui';
import { runStore } from '../src/run/device/run-files';
import { formatDuration, formatMiles } from '../src/run/format';
import { listRuns, type StoredRun } from '../src/run/queue';
import { flushRuns, runController } from '../src/run/runtime';
import { Brand, Gated, Note, Panel, Screen, styles } from '../src/run/ui/Screen';
import { useRun, useRunAccount, useWaitingRuns } from '../src/run/use-run';

const STATUS_TEXT: Record<StoredRun['status'], string> = {
  uploaded: 'Saved',
  pending: 'Waiting for a connection',
  needs_attention: 'Needs attention',
  local_only: 'On this phone only',
};

function Home() {
  const router = useRouter();
  const account = useRunAccount();
  const run = useRun();
  const waiting = useWaitingRuns();
  const [runs, setRuns] = useState<StoredRun[]>([]);
  const [recovered, setRecovered] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const ownerId = account.ownerId;

  const refresh = useCallback(async () => {
    if (!ownerId) return;
    try { setRuns(await listRuns(runStore, ownerId)); }
    catch (cause) { setError(`Could not read the runs saved on this phone: ${cause instanceof Error ? cause.message : String(cause)}`); }
  }, [ownerId]);

  // A run cut short by the app closing is brought back, never silently dropped.
  useEffect(() => {
    if (!ownerId) return;
    runController.recover(ownerId)
      .then((outcome) => {
        if (outcome === 'paused') setRecovered('VantraRun closed during your last run. It is paused where it stopped: resume it, or finish it to save what was recorded.');
        if (outcome === 'saved') { setRecovered('Your last run was recovered and saved.'); void refresh(); }
      })
      .catch((cause: unknown) => setError(`A run in progress could not be recovered: ${cause instanceof Error ? cause.message : String(cause)}`));
  }, [ownerId, refresh]);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  useEffect(() => { void refresh(); }, [waiting, refresh]);

  async function retry() {
    setRetrying(true);
    await flushRuns();
    await refresh();
    setRetrying(false);
  }

  return <Screen>
    <Brand />
    <SectionHeading kicker="READY" title="Go for a run."
      subtitle="Pick how you want to run and which zone to aim for. VantraRun tells you when pace or heart rate leaves it." />
    <ErrorNotice message={error} />
    {!!recovered && <Panel><Text style={styles.body}>{recovered}</Text></Panel>}
    {run
      ? <Action label={run.status === 'paused' ? 'Back to your paused run' : 'Back to your run'} onPress={() => router.push('/run-live')} />
      : <Action label="Start a run" onPress={() => router.push('/run-start')} />}

    {(waiting.pending > 0 || waiting.needsAttention > 0) && <Panel>
      <Text style={styles.label}>NOT ON THE SERVER YET</Text>
      {waiting.pending > 0 && <Text style={styles.body}>
        {waiting.pending} run{waiting.pending === 1 ? '' : 's'} waiting for a connection. {waiting.pending === 1 ? 'It is' : 'They are'} safe on this phone and will be sent automatically.
      </Text>}
      {waiting.needsAttention > 0 && <Text style={styles.body}>
        {waiting.needsAttention} run{waiting.needsAttention === 1 ? '' : 's'} the server did not accept. Open {waiting.needsAttention === 1 ? 'it' : 'one'} below to see why.
      </Text>}
      <Action label="Try sending now" onPress={() => { void retry(); }} busy={retrying} secondary />
    </Panel>}

    {runs.length > 0 && <>
      <Text style={[styles.label, { marginTop: 22, marginBottom: 10 }]}>RECENT RUNS ON THIS PHONE</Text>
      {runs.slice(0, 10).map((item) => <Pressable key={item.summary.externalId} accessibilityRole="button"
        onPress={() => router.push({ pathname: '/run-summary', params: { id: item.summary.externalId } })}
        style={({ pressed }) => [styles.panel, pressed && { opacity: 0.7 }]}>
        <View style={styles.row}>
          <Text style={styles.title}>{formatMiles(item.summary.distanceMi)} mi · {formatDuration(item.summary.durationSec)}</Text>
        </View>
        <Text style={styles.body}>{item.summary.routeName} · {new Date(item.summary.startedAt).toLocaleDateString()}</Text>
        <Text style={styles.label}>{STATUS_TEXT[item.status].toUpperCase()}</Text>
      </Pressable>)}
    </>}

    <Action label="Import a run from Apple Health or Health Connect" onPress={() => router.push('/activities')} secondary />
    <Action label="Settings" onPress={() => router.push('/settings')} secondary />
    <Note>Routes are created on the website and appear here when you choose a pre-mapped run.</Note>
  </Screen>;
}

export default function HomeScreen() {
  return <Gated><Home /></Gated>;
}
