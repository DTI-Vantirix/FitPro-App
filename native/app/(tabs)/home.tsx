import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../../src/auth/session';
import { Action, Card, ErrorNotice, Heading, Icon, Label, Notice, StatBlock } from '../../src/components/Ui';
import { listServerRuns, type ServerRun } from '../../src/run/api';
import { mergeRuns, weekStats, type DashRun } from '../../src/run/dashboard';
import { runStore } from '../../src/run/device/run-files';
import { formatDuration, formatMiles } from '../../src/run/format';
import { listRuns, type StoredRun } from '../../src/run/queue';
import { flushRuns, runController } from '../../src/run/runtime';
import { Brand, Gated, Note, Panel, Screen, styles } from '../../src/run/ui/Screen';
import { useRun, useRunAccount, useWaitingRuns } from '../../src/run/use-run';
import { formatPace } from '../../src/run/zones';
import { colors } from '../../src/theme';
import { display, stat, type } from '../../src/typography';

const STATUS_TEXT: Record<DashRun['status'], string> = {
  saved: 'Saved',
  pending: 'Waiting for a connection',
  needs_attention: 'Needs attention',
  local_only: 'On this phone only',
};

/** The runs on this phone, and the runner's runs from the server; null when it could not be reached. */
type Loaded = { stored: StoredRun[]; server: ServerRun[] | null; offline: boolean };

function Home() {
  const router = useRouter();
  const { accessToken } = useSession();
  const account = useRunAccount();
  const run = useRun();
  const waiting = useWaitingRuns();
  const [loaded, setLoaded] = useState<Loaded>({ stored: [], server: null, offline: false });
  const loadId = useRef(0);
  const [recovered, setRecovered] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const ownerId = account.ownerId;

  const refresh = useCallback(async () => {
    if (!ownerId) return;
    const id = loadId.current + 1;
    loadId.current = id;
    // The phone's runs are read first: a run that finishes uploading while the server is being
    // asked is then on both lists and counted once, never on neither.
    let stored: StoredRun[] | null = null;
    try {
      stored = await listRuns(runStore, ownerId);
    } catch (cause) {
      setError(`Could not read the runs saved on this phone: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    if (id !== loadId.current) return;
    // Until the server answers for the first time, the phone's own runs are shown.
    if (stored) { const fresh = stored; setLoaded((current) => (current.server === null ? { ...current, stored: fresh } : current)); }
    let server: ServerRun[] | null = null;
    try {
      if (accessToken) server = await listServerRuns(accessToken, ownerId, { limit: 40 });
    } catch {
      // No connection, or the server refused: the phone's own runs are shown, with a note.
    }
    if (id !== loadId.current) return;
    setLoaded((current) => ({ stored: stored ?? current.stored, server, offline: server === null }));
  }, [ownerId, accessToken]);

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

  const runs = useMemo(() => mergeRuns(loaded.server, loaded.stored), [loaded]);
  const week = useMemo(() => weekStats(runs, new Date()), [runs]);
  const up = week.deltaPct >= 0;
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
      <View style={local.distanceTop}>
        <Label>Distance this week</Label>
        <View style={local.delta} accessible accessibilityLabel={`${up ? 'Up' : 'Down'} ${Math.abs(week.deltaPct)} percent against last week`}>
          <View style={local.deltaChip}>
            <Icon name={up ? 'trending-up' : 'trending-down'} size={14} color={up ? colors.accent : colors.text} />
            <Text style={[stat(15), { color: up ? colors.accent : colors.text }]}>{up ? '+' : '−'}{Math.abs(week.deltaPct)}%</Text>
          </View>
          <Label style={local.deltaLabel}>vs last week</Label>
        </View>
      </View>
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
    {loaded.offline && <Note>VantraRun could not be reached, so these are the runs stored on this phone. Your full history returns with a connection.</Note>}

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
      <View style={local.recentHeader}>
        <Heading>Recent activity</Heading>
        <Pressable accessibilityRole="button" accessibilityLabel="Import runs" hitSlop={10} onPress={() => router.push('/activities')}
          style={({ pressed }) => [local.link, pressed && local.pressed]}>
          <Label>Import</Label>
          <Icon name="arrow-right" size={12} color={colors.subtle} />
        </Pressable>
      </View>
      {runs.length === 0 && <Text style={styles.body}>{loaded.offline ? 'No runs stored on this phone.' : 'No runs yet. Start one with the button below.'}</Text>}
      {runs.slice(0, 10).map((item, index) => {
        const row = <>
          <View style={local.itemText}>
            <Text style={type.bodyStrong} numberOfLines={1}>{item.routeName}</Text>
            <Text style={type.small}>
              {item.startedAt ? new Date(item.startedAt).toLocaleDateString() : 'No date'} · {formatMiles(item.distanceMi)} mi · {formatPace(item.avgPaceSec)} /mi
            </Text>
            <Label style={item.status === 'needs_attention' ? local.attention : undefined}>{STATUS_TEXT[item.status]}</Label>
          </View>
          <View style={local.itemValue}>
            <Text style={stat(24)}>{formatDuration(item.durationSec)}</Text>
            <Label>Time</Label>
          </View>
        </>;
        // Only a run still kept on this phone has a summary to open.
        const localId = item.localId;
        return localId
          ? <Pressable key={item.key} accessibilityRole="button"
            onPress={() => router.push({ pathname: '/run-summary', params: { id: localId } })}
            style={({ pressed }) => [local.item, index > 0 && local.itemDivider, pressed && local.pressed]}>
            {row}
            <Icon name="chevron-right" size={18} color={colors.subtle} />
          </Pressable>
          : <View key={item.key} style={[local.item, index > 0 && local.itemDivider]}>
            {row}
            <View style={local.noChevron} />
          </View>;
      })}
    </Card>

    <Note>Routes you draw in the Routes tab or on the website appear when you choose a pre-mapped run.</Note>
  </Screen>;
}

const local = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 20, paddingHorizontal: 4 },
  titleText: { flexShrink: 1, gap: 8 },
  resume: { marginBottom: 16 },
  distanceCard: { minHeight: 180, justifyContent: 'space-between' },
  distanceTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  delta: { alignItems: 'flex-end', gap: 4 },
  deltaChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.background, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  deltaLabel: { fontSize: 10 },
  distanceRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  baseline: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  distanceUnit: { fontSize: 12 },
  runCount: { color: colors.muted, paddingBottom: 10 },
  grid: { flexDirection: 'row', gap: 14 },
  mini: { flex: 1 },
  recent: { marginTop: 8, gap: 4 },
  recentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  noChevron: { width: 18 },
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
