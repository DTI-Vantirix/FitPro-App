import React, { useEffect, useMemo, useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { Action, ErrorNotice, Toggle } from '../src/components/Ui';
import { prepareAlerts } from '../src/run/device/alerts';
import { saveMute } from '../src/run/device/prefs';
import { formatDistanceAway, formatDuration, formatMiles, hrLabel, paceLabel, zoneLine } from '../src/run/format';
import { METERS_PER_MILE } from '../src/run/geo';
import { runController } from '../src/run/runtime';
import { RunMap } from '../src/run/ui/RunMap';
import { Gated, Loading, Screen } from '../src/run/ui/Screen';
import { useHeartRateSensor, useRun } from '../src/run/use-run';
import { formatPace, hrBounds } from '../src/run/zones';
import { colors } from '../src/theme';
import { heading, stat, type } from '../src/typography';

const STATUS_COLOR = { in: colors.accent, out: colors.notice, none: colors.subtle };

/** In zone is Volt; out of zone is Chalk and says which way; no reading is Steel. */
function valueColor(status: string): string {
  return status === 'in' ? STATUS_COLOR.in : status === 'unknown' ? STATUS_COLOR.none : STATUS_COLOR.out;
}

function Marker({ status }: { status: string }) {
  const symbol = status === 'in' ? '●' : status === 'faster' || status === 'above' ? '▲' : status === 'slower' || status === 'below' ? '▼' : '○';
  const color = status === 'in' ? STATUS_COLOR.in : status === 'unknown' ? STATUS_COLOR.none : STATUS_COLOR.out;
  return <Text style={[styles.marker, { color }]}>{symbol}</Text>;
}

function RunLive() {
  useKeepAwake();
  const router = useRouter();
  const run = useRun();
  const sensor = useHeartRateSensor();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A run brought back after the app was closed arrives here without passing the start screen.
  useEffect(() => { void prepareAlerts(); }, []);
  const trackPoints = run?.track.points;
  const track = useMemo(() => (trackPoints ?? []).map((p) => ({ lat: p.lat, lng: p.lng })), [trackPoints]);

  // While the run is being saved the controller has already let go of it; wait for the
  // summary to open instead of bouncing through the home screen.
  if (!run) return busy ? <Loading label="Saving your run…" /> : <Redirect href="/home" />;

  const { config } = run;
  const showMap = config.mode !== 'free';
  const bounds = hrBounds(config.zone, config.hrMax);
  const paused = run.status === 'paused';
  const directionsMissing = config.mode === 'route' && config.route !== null && config.route.maneuvers.length === 0;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const id = await runController.finish();
      router.replace({ pathname: '/run-summary', params: { id } });
    } catch (cause) {
      setError(`The run could not be saved to this phone: ${cause instanceof Error ? cause.message : String(cause)}. It has not been lost. Try Finish again.`);
      setBusy(false);
    }
  }

  function confirmFinish() {
    Alert.alert('Finish this run?', 'It is saved to your phone and sent to VantraRun.', [
      { text: 'Keep running', style: 'cancel' },
      { text: 'Discard run', style: 'destructive', onPress: confirmDiscard },
      { text: 'Finish and save', onPress: () => { void save(); } },
    ]);
  }

  function confirmDiscard() {
    Alert.alert('Discard this run?', 'Nothing from this run will be kept. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => { void runController.discard(); } },
    ]);
  }

  function changeMute(next: { pace: boolean; hr: boolean }) {
    runController.setMute(next);
    void saveMute(next);
  }

  const hrText = run.bpm == null ? (sensor.status === 'lost' ? 'sensor lost' : 'no sensor') : run.hrStatus === 'unknown' ? 'no range set' : hrLabel(run.hrStatus);

  return <Screen scroll={false}>
    {config.mode === 'route' && <View style={styles.directions}>
      {run.nav.offRoute
        ? <Text style={styles.offRoute}>Off route</Text>
        : run.next
          ? <View style={styles.spread}>
              <Text style={styles.turn} numberOfLines={2}>{run.next.maneuver.instruction}</Text>
              <Text style={styles.turnDistance}>{formatDistanceAway(run.next.metersAway)}</Text>
            </View>
          : <Text style={styles.turnQuiet}>{directionsMissing ? 'Spoken turns unavailable. Follow the line on the map.' : config.route?.name ?? 'Route'}</Text>}
    </View>}

    {showMap && <View style={styles.map}>
      <RunMap live route={config.route?.path} track={track}
        nextTurn={run.next && !run.nav.offRoute ? { lat: run.next.maneuver.lat, lng: run.next.maneuver.lng } : null} />
    </View>}

    <View style={[styles.stats, !showMap && styles.statsTall]}>
      <View style={styles.spread}>
        <View style={styles.block}>
          <Text style={type.label}>Distance</Text>
          <Text style={stat(showMap ? 48 : 64)}>{formatMiles(run.track.meters / METERS_PER_MILE)} <Text style={styles.unit}>mi</Text></Text>
        </View>
        <View style={[styles.block, styles.right]}>
          <Text style={type.label}>Time</Text>
          <Text style={stat(showMap ? 48 : 64)}>{formatDuration(run.movingMs / 1000)}</Text>
        </View>
      </View>
      {paused && <Text style={styles.paused}>Paused</Text>}

      <View style={styles.rule} />
      <View style={styles.spread}>
        <View style={styles.block}>
          <Text style={type.label}>Pace</Text>
          <Text style={[stat(showMap ? 36 : 44), { color: valueColor(run.paceStatus) }]}>{formatPace(run.pace)} <Text style={styles.unit}>/mi</Text></Text>
          <View style={styles.status}><Marker status={run.paceStatus} /><Text style={styles.statusText}>{paceLabel(run.paceStatus)}</Text></View>
        </View>
        <View style={[styles.block, styles.divided]}>
          <Text style={type.label}>Heart rate</Text>
          <Text style={[stat(showMap ? 36 : 44), { color: valueColor(run.hrStatus) }]}>{run.bpm != null ? run.bpm : '--'} <Text style={styles.unit}>bpm</Text></Text>
          <View style={styles.status}><Marker status={run.hrStatus} /><Text style={styles.statusText}>{hrText}</Text></View>
        </View>
      </View>
      <Text style={styles.zone}>{zoneLine(config.zone, bounds)}</Text>

      <View style={styles.mutes}>
        <View style={styles.mute}>
          <Text style={styles.muteText}>Pace cues</Text>
          <Toggle label="Pace cues" value={!run.mute.pace} onValueChange={(on) => changeMute({ ...run.mute, pace: !on })} />
        </View>
        <View style={styles.mute}>
          <Text style={styles.muteText}>HR cues</Text>
          <Toggle label="Heart-rate cues" value={!run.mute.hr} onValueChange={(on) => changeMute({ ...run.mute, hr: !on })} />
        </View>
      </View>
    </View>

    <ErrorNotice message={error} />
    <View style={styles.buttons}>
      <View style={styles.button}>
        {paused
          ? <Action label="Resume" icon="play" onPress={() => { void runController.resume().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))); }} disabled={busy} />
          : <Action label="Pause" icon="pause" onPress={() => runController.pause()} disabled={busy} secondary />}
      </View>
      <View style={styles.button}><Action label="Finish" onPress={confirmFinish} busy={busy} secondary={!paused} /></View>
    </View>
  </Screen>;
}

const styles = StyleSheet.create({
  directions: { backgroundColor: colors.panel, borderColor: colors.panelBorder, borderWidth: 1, borderRadius: 20, padding: 14, marginBottom: 10, minHeight: 62, justifyContent: 'center' },
  spread: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  turn: { ...heading(18), flex: 1 },
  turnDistance: { ...stat(24), color: colors.accent },
  turnQuiet: { ...type.body },
  offRoute: { ...heading(22), color: colors.notice },
  map: { flex: 1, minHeight: 160, marginBottom: 10 },
  stats: { backgroundColor: colors.panel, borderColor: colors.panelBorder, borderWidth: 1, borderRadius: 22, padding: 16, gap: 10 },
  statsTall: { flex: 1, justifyContent: 'center', gap: 18 },
  block: { flex: 1, gap: 4 },
  right: { alignItems: 'flex-end' },
  divided: { borderLeftWidth: 1, borderLeftColor: colors.panelBorder, paddingLeft: 14 },
  rule: { height: 1, backgroundColor: colors.panelBorder },
  unit: { ...type.label, fontSize: 11 },
  paused: { ...type.label, color: colors.notice, fontSize: 13 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  marker: { fontSize: 14 },
  statusText: { ...type.bodyStrong, fontSize: 14 },
  zone: { ...type.body, fontSize: 14 },
  mutes: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 2 },
  mute: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  muteText: { ...type.small },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 2 },
  button: { flex: 1 },
});

export default function RunLiveScreen() {
  return <Gated setup={false}><RunLive /></Gated>;
}
