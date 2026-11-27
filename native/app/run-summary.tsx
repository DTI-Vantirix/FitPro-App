import React, { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Action, ErrorNotice, Heading, Label, StatRow } from '../src/components/Ui';
import { runStore } from '../src/run/device/run-files';
import { formatDuration, formatMiles } from '../src/run/format';
import { retryRun, type StoredRun } from '../src/run/queue';
import { flushRuns } from '../src/run/runtime';
import { RunMap } from '../src/run/ui/RunMap';
import { Brand, Gated, Loading, Note, Panel, Screen, styles as shared } from '../src/run/ui/Screen';
import { useRunAccount, useWaitingRuns } from '../src/run/use-run';
import { formatPace } from '../src/run/zones';
import { display, stat } from '../src/typography';

function RunSummary() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const account = useRunAccount();
  const waiting = useWaitingRuns();
  const [run, setRun] = useState<StoredRun | null | 'missing'>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (typeof id !== 'string') { setRun('missing'); return; }
    try {
      const stored = await runStore.read(id);
      // A run is only ever shown to the account that recorded it.
      setRun(stored && stored.ownerId === account.ownerId ? stored : 'missing');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setRun('missing');
    }
  }, [id, account.ownerId]);

  useEffect(() => { void load(); }, [load, waiting]);

  async function sendNow() {
    if (typeof id !== 'string') return;
    setBusy(true);
    await retryRun(runStore, id).catch(() => {});
    await flushRuns();
    await load();
    setBusy(false);
  }

  if (run === null) return <Loading />;
  if (run === 'missing') {
    return <Screen>
      <Brand nav={false} />
      <ErrorNotice message={error} />
      <Text style={shared.body}>That run is not on this phone.</Text>
      <Action label="Home" onPress={() => router.replace('/home')} />
    </Screen>;
  }

  const s = run.summary;
  const hasMap = s.points.length >= 2;
  return <Screen>
    <Brand nav={false} />
    <View style={styles.hero}>
      <Label>Run complete · {new Date(s.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</Label>
      <Heading size={22}>{s.routeName}</Heading>
      <View style={styles.distance}>
        <Text style={display(104)}>{formatMiles(s.distanceMi)}</Text>
        <Label style={styles.distanceUnit}>mi</Label>
      </View>
    </View>

    <StatRow boxed size={26} items={[
      { label: 'Time', value: formatDuration(s.durationSec) },
      { label: 'Avg pace', value: formatPace(s.avgPaceSec), unit: '/mi' },
      { label: 'Pace in zone', value: s.paceInZonePct != null ? `${s.paceInZonePct}%` : '–', highlight: s.paceInZonePct != null },
    ]} />

    <Panel>
      <Heading size={16}>Heart rate</Heading>
      {s.hr ? <StatRow items={[
        { label: 'Max', value: String(s.hr.max), unit: 'bpm' },
        { label: 'Min', value: String(s.hr.min), unit: 'bpm' },
        { label: 'Avg', value: String(s.hr.avg), unit: 'bpm' },
      ]} /> : <Text style={shared.body}>No heart-rate sensor was connected for this run.</Text>}
    </Panel>

    <Panel>
      <Heading size={16}>Time in zone · {s.zone.name}</Heading>
      <Text style={shared.body}>
        Pace {formatPace(s.zone.fast_sec)}–{formatPace(s.zone.slow_sec)} /mi: {s.paceInZonePct != null ? `${s.paceInZonePct}% of the run` : 'not measured'}
      </Text>
      <Text style={shared.body}>
        {s.zone.hrMin != null && s.zone.hrMax != null ? `Heart rate ${s.zone.hrMin}–${s.zone.hrMax} bpm: ` : 'Heart rate: '}
        {s.hrInZonePct != null ? `${s.hrInZonePct}% of the time with a reading` : 'not measured'}
      </Text>
    </Panel>

    <Panel>
      <Heading size={16}>Mile splits</Heading>
      {s.splits.length === 0
        ? <Text style={shared.body}>No full mile completed.</Text>
        : s.splits.map((split) => <View key={split.mile} style={shared.row}>
            <Text style={shared.body}>Mile {split.mile}</Text>
            <Text style={styles.split}>{formatPace(split.pace_sec)}</Text>
          </View>)}
    </Panel>

    {hasMap && <View style={styles.map}><RunMap live={false} track={s.points} /></View>}

    <Panel>
      <Heading size={16}>Saving</Heading>
      {run.status === 'uploaded' && <Text style={shared.body}>Saved to VantraRun. It is on the website too.</Text>}
      {run.status === 'pending' && <>
        <Text style={shared.body}>Waiting for a connection. The run is safe on this phone and is sent automatically.</Text>
        {!!run.lastError && <Text style={shared.note}>Last try: {run.lastError}</Text>}
        <Action label="Try sending now" onPress={() => { void sendNow(); }} busy={busy} secondary />
      </>}
      {run.status === 'needs_attention' && <>
        <Text style={shared.body}>The server did not accept this run. It is still on this phone.</Text>
        <ErrorNotice message={run.lastError} />
        <Action label="Try again" onPress={() => { void sendNow(); }} busy={busy} secondary />
      </>}
      {run.status === 'local_only' && <Text style={shared.body}>Too short to save to VantraRun (under 0.01 mi). It is kept on this phone only.</Text>}
    </Panel>

    {/* Only a run the server has can be posted: the post is made from the server's copy. */}
    {run.status === 'uploaded' && <Action label="Share to feed" icon="share-2" secondary
      onPress={() => router.push({ pathname: '/share-run', params: run.serverRunId ? { run: run.serverRunId, ext: s.externalId } : { ext: s.externalId } })} />}
    <Action label="Done" onPress={() => router.replace('/home')} />
    <Note>{run.status === 'uploaded'
      ? 'Nothing is posted unless you share it, and you choose who sees it: only you, your friends or everyone on VantraRun.'
      : 'You can share this run to the feed once it is saved to VantraRun.'}</Note>
  </Screen>;
}

const styles = StyleSheet.create({
  hero: { gap: 8, marginBottom: 18, paddingHorizontal: 4 },
  distance: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 6 },
  distanceUnit: { fontSize: 13 },
  split: { ...stat(20) },
  map: { height: 240, marginBottom: 14 },
});

export default function RunSummaryScreen() {
  return <Gated setup={false}><RunSummary /></Gated>;
}
