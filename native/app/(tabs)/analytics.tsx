import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../../src/auth/session';
import { PaceTrendChart, WeeklyDistanceChart } from '../../src/components/Charts';
import { Action, Card, ErrorNotice, Heading, Icon, Label, StatBlock } from '../../src/components/Ui';
import { ANALYTICS_RUN_LIMIT, bestEfforts, movingTime, paceTrend, totals, weeklyDistance } from '../../src/run/analytics';
import { listServerRuns, type ServerRun } from '../../src/run/api';
import { Brand, Gated, Note, Screen } from '../../src/run/ui/Screen';
import { useRunAccount } from '../../src/run/use-run';
import { formatPace } from '../../src/run/zones';
import { colors } from '../../src/theme';
import { display, stat, type } from '../../src/typography';

/** Distance and pace over time, from the runs VantraRun holds for the runner: recorded here,
 * on the website or imported. The same figures as the website's Analytics page. */
function Analytics() {
  const router = useRouter();
  const { accessToken } = useSession();
  const { ownerId } = useRunAccount();
  const [runs, setRuns] = useState<ServerRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const loadId = useRef(0);

  const load = useCallback(async () => {
    if (!accessToken || !ownerId) return;
    const id = loadId.current + 1;
    loadId.current = id;
    setLoading(true);
    try {
      const list = await listServerRuns(accessToken, ownerId, { limit: ANALYTICS_RUN_LIMIT });
      if (id !== loadId.current) return;
      setRuns(list);
      setError(null);
    } catch (cause) {
      if (id !== loadId.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (id === loadId.current) setLoading(false);
    }
  }, [accessToken, ownerId]);

  // Reloads each time the tab is shown, so a run just finished is counted.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const figures = useMemo(() => {
    if (!runs || runs.length === 0) return null;
    return { weekly: weeklyDistance(runs, new Date()), trend: paceTrend(runs), totals: totals(runs), best: bestEfforts(runs) };
  }, [runs]);
  const time = figures ? movingTime(figures.totals.timeSec) : null;

  return <Screen>
    <Brand />
    <View style={local.titleRow}>
      <View style={local.titleText}>
        <Label>All time</Label>
        <Text accessibilityRole="header" style={display(36)}>Analytics</Text>
      </View>
      <Action label="Pace zones" compact secondary onPress={() => router.push('/zones')} />
    </View>

    <ErrorNotice message={error} />
    {runs === null && !error && <View style={local.loading}><ActivityIndicator color={colors.accent} /><Text style={type.body}>Loading your runs…</Text></View>}
    {runs === null && !!error && <>
      <Note>Analytics are worked out from the runs saved to VantraRun, so they need a connection.</Note>
      <Action label="Try again" secondary onPress={() => { void load(); }} busy={loading} />
    </>}

    {runs !== null && !figures && <Card style={local.empty}>
      <View style={local.emptyIcon}><Icon name="trending-up" size={22} color={colors.accent} /></View>
      <Heading style={local.center}>No training data yet</Heading>
      <Text style={[type.body, local.center]}>Log a run and your distance and pace trends build up here.</Text>
      <Action label="Start a run" icon="play" onPress={() => router.push('/run-start')} />
    </Card>}

    {figures && time && <>
      <Card>
        <StatBlock label="Total distance" value={figures.totals.miles.toFixed(1)} unit="mi" size={44} highlight
          caption={`${figures.totals.runs} ${figures.totals.runs === 1 ? 'run' : 'runs'}`} />
      </Card>
      <View style={local.grid}>
        <Card style={local.mini}>
          <StatBlock label="Avg pace" value={figures.totals.avgPaceSec == null ? '–' : formatPace(figures.totals.avgPaceSec)} unit="/mi" caption="Across all runs" />
        </Card>
        <Card style={local.mini}>
          <StatBlock label="Moving time" value={time.value} unit={time.unit} caption="Running only" />
        </Card>
      </View>

      <Card>
        <View style={local.cardHeader}>
          <Heading>Weekly distance</Heading>
          <Label>Last 8 weeks · mi</Label>
        </View>
        <WeeklyDistanceChart data={figures.weekly} />
      </Card>

      <Card>
        <View style={local.cardHeader}>
          <Heading>Pace trend</Heading>
          <Label>{figures.trend.length} {figures.trend.length === 1 ? 'run' : 'runs'} · /mi</Label>
        </View>
        {figures.trend.length > 1
          ? <>
            <PaceTrendChart data={figures.trend} />
            <Text style={type.small}>Higher on the chart is faster.</Text>
          </>
          : <Text style={[type.body, local.center, local.unlock]}>Two runs unlock your pace trend.</Text>}
      </Card>

      <Card>
        <Heading>Zone discipline</Heading>
        <Text style={type.small}>How often each zone was your target.</Text>
        {figures.totals.zones.map((zone) => <View key={zone.name} style={local.zoneRow}
          accessible accessibilityLabel={`${zone.name}: ${zone.count} ${zone.count === 1 ? 'run' : 'runs'}`}>
          <Text style={[type.small, local.zoneName]} numberOfLines={1}>{zone.name}</Text>
          <View style={local.track}><View style={[local.fill, { width: `${Math.round(zone.share * 100)}%` }]} /></View>
          <Text style={[type.small, local.zoneCount]}>{zone.count}</Text>
        </View>)}
      </Card>

      <Card>
        <Heading>Best efforts</Heading>
        {[
          { label: 'Longest run', value: figures.best.longest ? `${figures.best.longest.distanceMi.toFixed(2)} mi` : '–', sub: figures.best.longest?.routeName ?? '' },
          { label: 'Fastest avg pace', value: figures.best.fastest ? `${formatPace(figures.best.fastest.avgPaceSec)} /mi` : '–', sub: figures.best.fastest?.routeName ?? '' },
        ].map((row, index) => <View key={row.label} style={[local.bestRow, index > 0 && local.divider]}>
          <View style={local.bestText}>
            <Text style={type.bodyStrong}>{row.label}</Text>
            {!!row.sub && <Text style={type.small} numberOfLines={1}>{row.sub}</Text>}
          </View>
          <Text style={stat(22)}>{row.value}</Text>
        </View>)}
      </Card>
      {runs !== null && runs.length >= ANALYTICS_RUN_LIMIT && <Note>Worked out from your latest {ANALYTICS_RUN_LIMIT} runs.</Note>}
    </>}
  </Screen>;
}

const local = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 20, paddingHorizontal: 4 },
  titleText: { flexShrink: 1, gap: 8 },
  loading: { alignItems: 'center', gap: 12, paddingVertical: 48 },
  empty: { alignItems: 'stretch', paddingVertical: 28, gap: 12 },
  emptyIcon: { alignSelf: 'center', width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.selectedBg },
  center: { textAlign: 'center' },
  unlock: { paddingVertical: 28 },
  grid: { flexDirection: 'row', gap: 14 },
  mini: { flex: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  zoneRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  zoneName: { width: 84 },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.selectedBg, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  zoneCount: { width: 28, textAlign: 'right', fontVariant: ['tabular-nums'] },
  bestRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderTopColor: colors.panelBorder },
  bestText: { flex: 1, gap: 2 },
});

export default function AnalyticsScreen() {
  return <Gated><Analytics /></Gated>;
}
