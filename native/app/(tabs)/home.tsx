import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Action, Card, ErrorNotice, Heading, Icon, Label, Notice, StatBlock } from '../../src/components/Ui';
import { runStore } from '../../src/run/device/run-files';
import { formatDuration, formatMiles } from '../../src/run/format';
import { listRuns, type StoredRun } from '../../src/run/queue';
import { flushRuns, runController } from '../../src/run/runtime';
import { Brand, Gated, Note, Panel, Screen, styles } from '../../src/run/ui/Screen';
import { useRun, useRunAccount, useWaitingRuns } from '../../src/run/use-run';
import { formatPace } from '../../src/run/zones';
import { colors } from '../../src/theme';
import { display, stat, type } from '../../src/typography';

const STATUS_TEXT: Record<StoredRun['status'], string> = {
  uploaded: 'Saved',
  pending: 'Waiting for a connection',
  needs_attention: 'Needs attention',
  local_only: 'On this phone only',
};

/** Monday 00:00 local time, the same week the website's dashboard uses. */
function startOfWeek(now: Date): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

/** This week's totals from the runs kept on this phone. Runs too short to be saved to
 * VantraRun are left out, so the numbers match what the website will count. */
function weekStats(runs: StoredRun[]) {
  const from = startOfWeek(new Date()).getTime();
  const week = runs.filter((item) => item.status !== 'local_only' && new Date(item.summary.startedAt).getTime() >= from);
  const distance = week.reduce((sum, item) => sum + item.summary.distanceMi, 0);
  const time = week.reduce((sum, item) => sum + item.summary.durationSec, 0);
  return { runs: week.length, distance, time, avgPaceSec: distance > 0.1 ? time / distance : null };
}

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

  const week = useMemo(() => weekStats(runs), [runs]);
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return <Screen>
    <Brand />
    <View style={local.titleRow}>
      <View style={local.titleText}>
        <Label>{today}</Label>
        <Text accessibilityRole="header" style={display(36)}>Your week</Text>
      </View>
      {!run && <Action label="Start a run" icon="play" compact onPress={() => router.push('/run-start')} />}
    </View>

    <ErrorNotice message={error} />
    {!!recovered && <Notice>{recovered}</Notice>}
    {run && <View style={local.resume}>
      <Action label={run.status === 'paused' ? 'Back to your paused run' : 'Back to your run'} icon="play" onPress={() => router.push('/run-live')} />
    </View>}

    <Card style={local.distanceCard}>
      <Label>Distance this week</Label>
      <View style={local.distanceRow}>
        <View style={local.baseline}>
          <Text style={display(84)}>{week.distance.toFixed(1)}</Text>
          <Label style={local.distanceUnit}>mi</Label>
        </View>
        <Text style={[type.small, local.runCount]}>{week.runs} {week.runs === 1 ? 'run' : 'runs'}</Text>
      </View>
    </Card>

    <View style={local.grid}>
      <Card style={local.mini}>
        <StatBlock label="Runs" value={String(week.runs)} unit="sessions" caption="Since Monday" highlight={week.runs > 0} />
      </Card>
      <Card style={local.mini}>
        <StatBlock label="Avg pace" value={week.avgPaceSec == null ? '–' : formatPace(week.avgPaceSec)} unit="/mi" caption="This week" />
      </Card>
    </View>
    <Card>
      <StatBlock label="Moving time" value={String(Math.round(week.time / 60))} unit="min" caption="This week" />
    </Card>
    <Note>Counted from the runs recorded on this phone. Runs added on the website or imported from your watch are not included here yet.</Note>

    {(waiting.pending > 0 || waiting.needsAttention > 0) && <Panel>
      <Heading>Not on the server yet</Heading>
      {waiting.pending > 0 && <Text style={styles.body}>
        {waiting.pending} run{waiting.pending === 1 ? '' : 's'} waiting for a connection. {waiting.pending === 1 ? 'It is' : 'They are'} safe on this phone and will be sent automatically.
      </Text>}
      {waiting.needsAttention > 0 && <Text style={styles.body}>
        {waiting.needsAttention} run{waiting.needsAttention === 1 ? '' : 's'} the server did not accept. Open {waiting.needsAttention === 1 ? 'it' : 'one'} below to see why.
      </Text>}
      <Action label="Try sending now" onPress={() => { void retry(); }} busy={retrying} secondary />
    </Panel>}

    <Card style={local.recent}>
      <Heading>Recent activity</Heading>
      {runs.length === 0 && <Text style={styles.body}>No runs recorded on this phone yet.</Text>}
      {runs.slice(0, 10).map((item, index) => <Pressable key={item.summary.externalId} accessibilityRole="button"
        onPress={() => router.push({ pathname: '/run-summary', params: { id: item.summary.externalId } })}
        style={({ pressed }) => [local.item, index > 0 && local.itemDivider, pressed && local.pressed]}>
        <View style={local.itemText}>
          <Text style={type.bodyStrong} numberOfLines={1}>{item.summary.routeName}</Text>
          <Text style={type.small}>
            {new Date(item.summary.startedAt).toLocaleDateString()} · {formatMiles(item.summary.distanceMi)} mi · {formatPace(item.summary.avgPaceSec)} /mi
          </Text>
          <Label style={item.status === 'needs_attention' ? local.attention : undefined}>{STATUS_TEXT[item.status]}</Label>
        </View>
        <View style={local.itemValue}>
          <Text style={stat(24)}>{formatDuration(item.summary.durationSec)}</Text>
          <Label>Time</Label>
        </View>
        <Icon name="chevron-right" size={18} color={colors.subtle} />
      </Pressable>)}
    </Card>

    <Note>Routes you draw in the Routes tab or on the website appear when you choose a pre-mapped run.</Note>
  </Screen>;
}

const local = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 20, paddingHorizontal: 4 },
  titleText: { flexShrink: 1, gap: 8 },
  resume: { marginBottom: 16 },
  distanceCard: { minHeight: 180, justifyContent: 'space-between' },
  distanceRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  baseline: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  distanceUnit: { fontSize: 12 },
  runCount: { color: colors.muted, paddingBottom: 10 },
  grid: { flexDirection: 'row', gap: 14 },
  mini: { flex: 1 },
  recent: { marginTop: 8, gap: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  itemDivider: { borderTopWidth: 1, borderTopColor: colors.panelBorder },
  itemText: { flex: 1, gap: 3 },
  itemValue: { alignItems: 'flex-end', gap: 2 },
  attention: { color: colors.text },
  pressed: { opacity: 0.7 },
});

export default function HomeScreen() {
  return <Gated><Home /></Gated>;
}
