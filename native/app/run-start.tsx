import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { useSession } from '../src/auth/session';
import { Action, ErrorNotice, SectionHeading } from '../src/components/Ui';
import { fetchDirections, listRoutes, type Directions, type SavedRoute } from '../src/run/api';
import { prepareAlerts } from '../src/run/device/alerts';
import type { FoundSensor } from '../src/run/device/heart-rate';
import { requestRunPermissions } from '../src/run/device/location';
import { loadMute, saveMute } from '../src/run/device/prefs';
import { deviceCache } from '../src/run/device/run-files';
import type { Mute, RunMode } from '../src/run/engine';
import { heartRateMonitor, runController } from '../src/run/runtime';
import { Brand, Gated, Note, Panel, Screen, styles as shared } from '../src/run/ui/Screen';
import { useHeartRateSensor, useRun, useRunAccount } from '../src/run/use-run';
import { defaultZone, formatPace, hrBounds, type Zone } from '../src/run/zones';
import { colors } from '../src/theme';

const MODES: { mode: RunMode; title: string; detail: string }[] = [
  { mode: 'route', title: 'Pre-mapped route', detail: 'Follow one of your saved routes with turn-by-turn directions.' },
  { mode: 'free', title: 'Free run', detail: 'No map. Distance, time, pace and zone coaching.' },
  { mode: 'free_map', title: 'Free run with map', detail: 'A live map of where you are and where you have been.' },
];

function RunStart() {
  const router = useRouter();
  const { accessToken } = useSession();
  const account = useRunAccount();
  const active = useRun();
  const sensor = useHeartRateSensor();
  const [mode, setMode] = useState<RunMode>('free');
  const [routes, setRoutes] = useState<SavedRoute[] | null>(null);
  const [routesNote, setRoutesNote] = useState<string | null>(null);
  const [route, setRoute] = useState<SavedRoute | null>(null);
  const [directions, setDirections] = useState<Directions | 'loading' | null>(null);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [mute, setMute] = useState<Mute>({ pace: false, hr: false });
  const [found, setFound] = useState<FoundSensor[]>([]);
  const [sensorError, setSensorError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopScan = useRef<(() => void) | null>(null);
  const directionsFor = useRef<string | null>(null);
  const { ownerId, zones, profile } = account;

  useEffect(() => { void loadMute().then(setMute); }, []);
  useEffect(() => () => { stopScan.current?.(); }, []);

  // Saved routes, from the server when it can be reached and from the last copy otherwise.
  useEffect(() => {
    if (mode !== 'route' || routes !== null || !accessToken || !ownerId) return;
    let live = true;
    listRoutes(accessToken, ownerId)
      .then((list) => { if (live) { setRoutes(list); setRoutesNote(null); } void deviceCache.write(`routes-${ownerId}`, list); })
      .catch(async () => {
        const cached = await deviceCache.read<SavedRoute[]>(`routes-${ownerId}`);
        if (!live) return;
        setRoutes(Array.isArray(cached) ? cached : []);
        setRoutesNote(Array.isArray(cached) ? 'No connection: showing the routes saved on this phone.' : 'No connection: your routes could not be loaded.');
      });
    return () => { live = false; };
  }, [mode, routes, accessToken, ownerId]);

  // Turn instructions are fetched when the route is opened and kept for the whole run.
  function chooseRoute(next: SavedRoute) {
    setRoute(next);
    setZoneId(null);
    setDirections('loading');
    directionsFor.current = next.id;
    if (!accessToken) return;
    void fetchDirections(accessToken, next.id).then((result) => {
      if (directionsFor.current === next.id) setDirections(result);
    });
  }

  const chosenRoute = mode === 'route' ? route : null;
  const zone: Zone | null = useMemo(
    () => zones.find((z) => z.id === zoneId) ?? defaultZone(zones, chosenRoute?.targetZoneId),
    [zones, zoneId, chosenRoute?.targetZoneId],
  );
  const bounds = zone ? hrBounds(zone, profile?.hr_max ?? null) : null;

  if (active) return <Redirect href="/run-live" />;

  function changeMute(next: Mute) {
    setMute(next);
    void saveMute(next);
  }

  async function findSensor() {
    setSensorError(null);
    setFound([]);
    try {
      stopScan.current?.();
      stopScan.current = await heartRateMonitor.scan((item) => setFound((list) => (list.some((s) => s.id === item.id) ? list : [...list, item])));
    } catch (cause) {
      setSensorError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function connectSensor(id: string) {
    setSensorError(null);
    stopScan.current?.();
    try { await heartRateMonitor.connect(id); setFound([]); }
    catch (cause) { setSensorError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function start() {
    if (!zone || !ownerId || (mode === 'route' && !route)) return;
    setStarting(true);
    setError(null);
    try {
      const permissions = await requestRunPermissions();
      if (!permissions.foreground) {
        throw new Error('VantraRun needs your location to measure distance and pace. Allow location access for VantraRun in your phone settings, then try again.');
      }
      await prepareAlerts();
      stopScan.current?.();
      const plan = mode === 'route' && route
        ? { id: route.id, name: route.name, path: route.path, maneuvers: directions && directions !== 'loading' && directions.available ? directions.maneuvers : [] }
        : null;
      await runController.begin({
        externalId: Crypto.randomUUID(),
        mode,
        zone,
        hrMax: profile?.hr_max ?? null,
        route: plan,
        ownerId,
      }, mute);
      // The live screen opens through the redirect above as soon as the run exists.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStarting(false);
    }
  }

  const canStart = Boolean(zone) && (mode !== 'route' || (route !== null && directions !== 'loading'));

  return <Screen>
    <Brand />
    <SectionHeading kicker="START A RUN" title="How do you want to run?" subtitle="Choose a mode, then the zone to aim for." />

    {MODES.map((item) => <Pressable key={item.mode} accessibilityRole="radio" accessibilityState={{ selected: mode === item.mode }}
      onPress={() => setMode(item.mode)} style={[shared.panel, mode === item.mode && local.selected]}>
      <Text style={shared.title}>{item.title}</Text>
      <Text style={shared.body}>{item.detail}</Text>
    </Pressable>)}

    {mode === 'route' && <View style={local.section}>
      <Text style={shared.label}>YOUR ROUTES</Text>
      {routes === null && <ActivityIndicator color={colors.accent} />}
      {!!routesNote && <Text style={shared.body}>{routesNote}</Text>}
      {routes !== null && routes.length === 0 && !routesNote &&
        <Text style={shared.body}>You have no saved routes yet. Create one on the website, or choose a free run.</Text>}
      {(routes ?? []).map((item) => <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ selected: route?.id === item.id }}
        onPress={() => chooseRoute(item)} style={[shared.panel, route?.id === item.id && local.selected]}>
        <Text style={shared.title}>{item.name}</Text>
        <Text style={shared.body}>
          {item.distanceMi != null ? `${item.distanceMi.toFixed(1)} mi` : 'Distance not set'}{item.targetZoneName ? ` · ${item.targetZoneName}` : ''}
        </Text>
      </Pressable>)}
      {route && directions === 'loading' && <Text style={shared.body}>Getting turn directions…</Text>}
      {route && directions && directions !== 'loading' && (directions.available
        ? <Text style={shared.body}>{directions.maneuvers.length} turn directions ready. They are kept on the phone for the run.</Text>
        : <Text style={shared.body}>Spoken turns are unavailable for this run. The route is still drawn on the map and "off route" is still reported.</Text>)}
    </View>}

    <View style={local.section}>
      <Text style={shared.label}>ZONE</Text>
      <View style={local.chips}>
        {zones.map((item) => <Pressable key={item.id ?? item.name} accessibilityRole="radio" accessibilityState={{ selected: zone?.id === item.id }}
          onPress={() => setZoneId(item.id ?? null)} style={[local.chip, zone?.id === item.id && local.chipSelected]}>
          <Text style={[local.chipText, zone?.id === item.id && local.chipTextSelected]}>{item.name}</Text>
        </Pressable>)}
      </View>
      {zone && <Panel>
        <Text style={shared.title}>{zone.name}</Text>
        <Text style={shared.body}>Pace {formatPace(zone.fast_sec)}–{formatPace(zone.slow_sec)} per mile</Text>
        <Text style={shared.body}>{bounds ? `Heart rate ${bounds.min}–${bounds.max} bpm` : 'Heart-rate range unknown: no max heart rate on your profile.'}</Text>
      </Panel>}
    </View>

    <View style={local.section}>
      <Text style={shared.label}>HEART-RATE SENSOR</Text>
      <Text style={shared.body}>
        {sensor.status === 'connected' ? `Connected: ${sensor.name ?? 'sensor'}`
          : sensor.status === 'connecting' ? 'Connecting…'
          : sensor.status === 'scanning' ? 'Looking for sensors…'
          : sensor.status === 'lost' ? 'Connection lost. Trying to reconnect…'
          : 'None connected. Without one, only pace is coached.'}
      </Text>
      <ErrorNotice message={sensorError} />
      {found.map((item) => <Action key={item.id} label={`Connect ${item.name}`} onPress={() => { void connectSensor(item.id); }} secondary />)}
      {sensor.status === 'connected' || sensor.status === 'lost'
        ? <Action label="Disconnect sensor" onPress={() => { void heartRateMonitor.disconnect(); }} secondary />
        : <Action label="Find a sensor" onPress={() => { void findSensor(); }} busy={sensor.status === 'scanning' || sensor.status === 'connecting'} secondary />}
      <Note>Works with Bluetooth chest straps and with Garmin watches set to broadcast heart rate. Apple Watch heart rate is not available yet.</Note>
    </View>

    <View style={local.section}>
      <Text style={shared.label}>CUES</Text>
      <View style={shared.row}>
        <Text style={shared.body}>Pace cues</Text>
        <Switch accessibilityLabel="Pace cues" value={!mute.pace} onValueChange={(on) => changeMute({ ...mute, pace: !on })} />
      </View>
      <View style={shared.row}>
        <Text style={shared.body}>Heart-rate cues</Text>
        <Switch accessibilityLabel="Heart-rate cues" value={!mute.hr} onValueChange={(on) => changeMute({ ...mute, hr: !on })} />
      </View>
      <Note>A cue is spoken, vibrates and appears as a notification when pace or heart rate leaves the zone and when it comes back. It tells you what changed, never what to do.</Note>
    </View>

    <ErrorNotice message={error} />
    <Action label="Start" onPress={() => { void start(); }} busy={starting} disabled={!canStart} />
    <Action label="Back" onPress={() => router.back()} secondary />
    <Note>VantraRun asks for your location when you press Start, and keeps recording with the screen locked.</Note>
  </Screen>;
}

const local = StyleSheet.create({
  selected: { borderColor: colors.accent, backgroundColor: colors.selectedBg },
  section: { marginTop: 14, marginBottom: 6, gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.panelBorder, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  chipTextSelected: { color: colors.accentText },
});

export default function RunStartScreen() {
  return <Gated><RunStart /></Gated>;
}
