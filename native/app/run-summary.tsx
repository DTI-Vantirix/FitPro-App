import React, { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Action, ErrorNotice, SectionHeading } from '../src/components/Ui';
import { runStore } from '../src/run/device/run-files';
import { formatDuration, formatMiles } from '../src/run/format';
import { retryRun, type StoredRun } from '../src/run/queue';
import { flushRuns } from '../src/run/runtime';
import { RunMap } from '../src/run/ui/RunMap';
import { Brand, Gated, Loading, Note, Panel, Screen, styles as shared } from '../src/run/ui/Screen';
import { useRunAccount, useWaitingRuns } from '../src/run/use-run';
import { formatPace } from '../src/run/zones';
import { colors } from '../src/theme';

function Stat({ label, value }: { label: string; value: string }) {
  return <View style={styles.stat}>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>;
}

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
      <Brand />
      <ErrorNotice message={error} />
      <Text style={shared.body}>That run is not on this phone.</Text>
      <Action label="Home" onPress={() => router.replace('/home')} />
    </Screen>;
  }

  const s = run.summary;
  const hasMap = s.points.length >= 2;
  return <Screen>
    <Brand />
    <SectionHeading kicker="RUN COMPLETE" title={s.routeName}
      subtitle={new Date(s.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} />

    <View style={styles.grid}>
      <Stat label="DISTANCE (MI)" value={formatMiles(s.distanceMi)} />
      <Stat label="TIME" value={formatDuration(s.durationSec)} />
      <Stat label="AVG PACE /MI" value={formatPace(s.avgPaceSec)} />
    </View>

    <Panel>
      <Text style={shared.label}>HEART RATE</Text>
      {s.hr ? <View style={styles.grid}>
        <Stat label="MAX" value={String(s.hr.max)} />
        <Stat label="MIN" value={String(s.hr.min)} />
        <Stat label="AVG" value={String(s.hr.avg)} />
      </View> : <Text style={shared.body}>No heart-rate sensor was connected for this run.</Text>}
    </Panel>

    <Panel>
      <Text style={shared.label}>TIME IN ZONE · {s.zone.name.toUpperCase()}</Text>
      <Text style={shared.body}>
        Pace {formatPace(s.zone.fast_sec)}–{formatPace(s.zone.slow_sec)} /mi: {s.paceInZonePct != null ? `${s.paceInZonePct}% of the run` : 'not measured'}
      </Text>
      <Text style={shared.body}>
        {s.zone.hrMin != null && s.zone.hrMax != null ? `Heart rate ${s.zone.hrMin}–${s.zone.hrMax} bpm: ` : 'Heart rate: '}
        {s.hrInZonePct != null ? `${s.hrInZonePct}% of the time with a reading` : 'not measured'}
      </Text>
    </Panel>

    <Panel>
      <Text style={shared.label}>MILE SPLITS</Text>
      {s.splits.length === 0
        ? <Text style={shared.body}>No full mile completed.</Text>
        : s.splits.map((split) => <View key={split.mile} style={shared.row}>
            <Text style={shared.body}>Mile {split.mile}</Text>
            <Text style={styles.split}>{formatPace(split.pace_sec)}</Text>
          </View>)}
    </Panel>

    {hasMap && <View style={styles.map}><RunMap live={false} track={s.points} /></View>}

    <Panel>
      <Text style={shared.label}>SAVING</Text>
      {run.status === 'uploaded' && <Text style={shared.body}>Saved to FitPro. It is on the website too.</Text>}
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
      {run.status === 'local_only' && <Text style={shared.body}>Too short to save to FitPro (under 0.01 mi). It is kept on this phone only.</Text>}
    </Panel>

    <Action label="Done" onPress={() => router.replace('/home')} />
    <Note>Sharing a run to the feed comes in a later version. Until then you can share it from the FitPro website.</Note>
  </Screen>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  stat: { flex: 1, backgroundColor: colors.panel, borderColor: colors.panelBorder, borderWidth: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center', gap: 4 },
  statValue: { color: colors.text, fontSize: 24, fontWeight: '900', fontVariant: ['tabular-nums'] },
  statLabel: { color: colors.subtle, fontSize: 10, letterSpacing: 1.2, fontWeight: '800' },
  split: { color: colors.text, fontWeight: '800', fontSize: 15, fontVariant: ['tabular-nums'] },
  map: { height: 240, marginBottom: 16 },
});

export default function RunSummaryScreen() {
  return <Gated setup={false}><RunSummary /></Gated>;
}
