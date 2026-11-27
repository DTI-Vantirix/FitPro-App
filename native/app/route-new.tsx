import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../src/auth/session';
import { Action, Card, ErrorNotice, Field, Heading, Icon, IconButton, Label, Notice, StatBlock, type IconName } from '../src/components/Ui';
import { createRoute, snapRoute } from '../src/run/api';
import { currentPosition, requestRunPermissions } from '../src/run/device/location';
import type { LatLng } from '../src/run/geo';
import { addPoint, atLimit, canSave, draftDistanceMi, hasOffroad, latestOnly, MAX_WAYPOINTS, movePoint, routeRecord, undoPoint,
  type SnapResult, type Waypoint } from '../src/run/route-draft';
import { RouteDrawMap } from '../src/run/ui/RunMap';
import { Gated } from '../src/run/ui/Screen';
import { useRunAccount } from '../src/run/use-run';
import { defaultZone } from '../src/run/zones';
import { colors } from '../src/theme';
import { fonts, type } from '../src/typography';

/** Where the map opens when the phone's location cannot be had: the website builder's own default. */
const FALLBACK_CENTER: LatLng = { lat: 40.7128, lng: -74.006 };
const LOCATION_WAIT_MS = 8000;
const NO_PERMISSION = 'Location access is off for VantraRun, so the map has not opened where you are. Allow location for VantraRun in your phone settings, or move the map to your area and draw from there.';
const NO_FIX = 'Your location could not be found, so the map has not opened where you are. Move the map to your area and draw from there, or step outside for a clearer signal.';

function MapButton({ label, icon, hint, disabled, onPress }: { label: string; icon: IconName; hint: string; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={hint} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [local.mapButton, pressed && local.pressed]}>
    <Icon name={icon} size={16} color={disabled ? colors.subtle : colors.text} />
    <Text style={[local.mapButtonText, disabled && local.mapButtonTextOff]}>{label}</Text>
  </Pressable>;
}

function RouteNew() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const { accessToken } = useSession();
  const { zones } = useRunAccount();
  const [points, setPoints] = useState<Waypoint[]>([]);
  const [snap, setSnap] = useState<SnapResult | null>(null);
  const [snapping, setSnapping] = useState(false);
  const [snapFailed, setSnapFailed] = useState(false);
  // How the next point joins the route: along roads and paths, or straight across open ground.
  const [offroad, setOffroad] = useState(false);
  const [name, setName] = useState('');
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [center, setCenter] = useState<LatLng | null>(null);
  const [recenter, setRecenter] = useState<LatLng | null>(null);
  const [here, setHere] = useState<LatLng | null>(null);
  const [locationAllowed, setLocationAllowed] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requests = useRef(latestOnly()).current;
  const pointsRef = useRef<Waypoint[]>([]);
  const opened = useRef(false);

  const zone = useMemo(() => zones.find((z) => z.id === zoneId) ?? defaultZone(zones), [zones, zoneId]);
  const distance = useMemo(() => draftDistanceMi(points, snap), [points, snap]);

  // The first location fix decides where the map opens. Nothing afterwards moves it.
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const open = (at: LatLng) => { opened.current = true; setCenter(at); };
    void (async () => {
      const permission = await requestRunPermissions().catch(() => ({ foreground: false }));
      if (!live) return;
      if (!permission.foreground) {
        setLocationNote(NO_PERMISSION);
        open(FALLBACK_CENTER);
        return;
      }
      setLocationAllowed(true);
      // A slow fix must not leave the runner with no map at all.
      timer = setTimeout(() => { if (live && !opened.current) open(FALLBACK_CENTER); }, LOCATION_WAIT_MS);
      const fix = await currentPosition();
      if (timer) clearTimeout(timer);
      if (!live) return;
      if (!fix) {
        setLocationNote(NO_FIX);
        if (!opened.current) open(FALLBACK_CENTER);
        return;
      }
      setHere(fix);
      if (!opened.current) open(fix);
      // The map opened before the fix arrived: centre once, unless drawing has already begun.
      else if (pointsRef.current.length === 0) setRecenter(fix);
    })();
    return () => { live = false; if (timer) clearTimeout(timer); requests.cancel(); };
  }, [requests]);

  function change(next: Waypoint[]) {
    if (next === pointsRef.current) return;
    pointsRef.current = next;
    setPoints(next);
    setError(null);
    if (next.length < 2 || !accessToken) {
      requests.cancel();
      setSnap(null);
      setSnapFailed(false);
      setSnapping(false);
      return;
    }
    const id = requests.begin();
    setSnapping(true);
    snapRoute(accessToken, next)
      .then((result) => {
        if (!requests.isCurrent(id)) return;
        setSnap(result.path.length >= 2 ? result : null);
        setSnapFailed(!result.snapped);
        setSnapping(false);
      })
      .catch(() => {
        if (!requests.isCurrent(id)) return;
        setSnap(null);
        setSnapFailed(true);
        setSnapping(false);
      });
  }

  async function addMyLocation() {
    setLocating(true);
    const fix = (await currentPosition()) ?? here;
    setLocating(false);
    if (!fix) { setLocationNote(NO_FIX); return; }
    setHere(fix);
    change(addPoint(pointsRef.current, fix, offroad));
  }

  async function save() {
    if (!accessToken || !canSave(name, points) || snapping) return;
    setSaving(true);
    setError(null);
    try {
      await createRoute(accessToken, routeRecord({ name, points, snap, zone }));
      // Back to the Routes tab, which reloads whenever it is shown.
      if (router.canGoBack()) router.back();
      else router.replace('/routes');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  }

  const full = atLimit(points);
  const mapHeight = Math.max(260, Math.round(window.height * 0.44));
  const hint = `${offroad ? 'Off-road: points join in a straight line' : 'Tap the map: the line follows the roads'}${points.length > 0 ? ' · hold a point, then drag, to move it' : ''}`;

  return <View style={[local.root, { paddingTop: insets.top + 12 }]}>
    <View style={local.header}>
      <IconButton icon="arrow-left" label="Back to routes" onPress={() => (router.canGoBack() ? router.back() : router.replace('/routes'))} />
      <View style={local.headerText}>
        <Label>{hint}</Label>
        <Heading>Draw a route</Heading>
      </View>
    </View>

    <View style={[local.mapFrame, { height: mapHeight }]}>
      {center
        ? <RouteDrawMap center={center} recenter={recenter} points={points} path={snap?.path ?? []} showsUser={locationAllowed}
          onAddPoint={(at) => change(addPoint(pointsRef.current, at, offroad))}
          onMovePoint={(index, at) => change(movePoint(pointsRef.current, index, at))} />
        : <View style={local.locating}><ActivityIndicator color={colors.accent} /><Text style={type.body}>Finding your location…</Text></View>}
      {/* On the map itself, so a wrong tap can be taken back without scrolling. */}
      <View style={local.mapActions} pointerEvents="box-none">
        <MapButton label="Undo" icon="rotate-ccw" hint="Undo last point" disabled={points.length === 0} onPress={() => change(undoPoint(pointsRef.current))} />
        <MapButton label="Clear" icon="trash-2" hint="Clear all points" disabled={points.length === 0} onPress={() => change([])} />
      </View>
      <View style={local.modes} accessibilityRole="radiogroup">
        {[{ value: false, label: 'Follow roads' }, { value: true, label: 'Off-road' }].map((mode) => <Pressable key={mode.label}
          accessibilityRole="radio" accessibilityState={{ selected: offroad === mode.value }} onPress={() => setOffroad(mode.value)}
          style={[local.mode, offroad === mode.value && local.modeOn]}>
          <Text style={[local.modeText, offroad === mode.value && local.modeTextOn]}>{mode.label}</Text>
        </Pressable>)}
      </View>
    </View>

    <KeyboardAvoidingView style={local.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[local.form, { paddingBottom: insets.bottom + 32 }]}>
        {!!locationNote && <Notice icon="alert-triangle">{locationNote}</Notice>}
        <Card>
          <Field label="Route name" value={name} onChangeText={setName} placeholder="Ironworks loop" autoCapitalize="sentences" />
          <View style={local.distance}>
            <StatBlock label="Distance" value={distance.toFixed(2)} unit="mi" />
            <Label>{snapping ? 'Following roads…' : `${points.length} ${points.length === 1 ? 'point' : 'points'}`}</Label>
          </View>
          {hasOffroad(points) && <Text style={type.small}>Off-road legs are drawn straight between your points, so add a point at each bend.</Text>}
          {snapFailed && <Text style={type.small}>Road data is unavailable right now, so the line joins your points directly. Your route still saves fine.</Text>}
          {full && <Text style={type.small}>A route can have up to {MAX_WAYPOINTS} points. Undo one to add another.</Text>}

          <View style={local.zones}>
            <Label>Default zone for this route</Label>
            <View style={local.chips}>
              {zones.map((item) => <Pressable key={item.id ?? item.name} accessibilityRole="radio" accessibilityState={{ selected: zone?.id === item.id }}
                onPress={() => setZoneId(item.id ?? null)} style={[local.chip, zone?.id === item.id && local.chipSelected]}>
                <Text style={[local.chipText, zone?.id === item.id && local.chipTextSelected]}>{item.name}</Text>
              </Pressable>)}
            </View>
          </View>

          <View style={local.locate}>
            <Action label="Add my location" icon="crosshair" secondary compact disabled={!locationAllowed || full} busy={locating} onPress={() => { void addMyLocation(); }} />
          </View>

          <ErrorNotice message={error} />
          <Action label={saving ? 'Saving…' : 'Save route'} icon="save" onPress={() => { void save(); }} busy={saving} disabled={!canSave(name, points) || snapping} />
          {points.length < 2 && <Text style={[type.small, local.center]}>Add at least two waypoints to save.</Text>}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  </View>;
}

const local = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, marginBottom: 12 },
  headerText: { flex: 1, gap: 4 },
  mapFrame: { marginHorizontal: 16, borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: colors.panelBorder, backgroundColor: colors.panel },
  locating: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  mapActions: { position: 'absolute', top: 12, right: 12, alignItems: 'flex-end', gap: 8 },
  mapButton: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1,
    borderColor: colors.panelBorder, backgroundColor: colors.background },
  mapButtonText: { fontFamily: fonts.bodyStrong, fontSize: 14, color: colors.text },
  mapButtonTextOff: { color: colors.subtle },
  pressed: { opacity: 0.7 },
  modes: { position: 'absolute', left: 12, bottom: 12, flexDirection: 'row', padding: 4, borderRadius: 999, borderWidth: 1,
    borderColor: colors.panelBorder, backgroundColor: colors.background },
  mode: { minHeight: 36, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center' },
  modeOn: { backgroundColor: colors.accent },
  modeText: { fontFamily: fonts.bodyStrong, fontSize: 12, color: colors.subtle },
  modeTextOn: { color: colors.accentText },
  form: { paddingHorizontal: 16, paddingTop: 14 },
  distance: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: 16, borderWidth: 1, borderColor: colors.panelBorder },
  zones: { gap: 8, marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.panelBorder, borderRadius: 999, paddingHorizontal: 16, minHeight: 40, justifyContent: 'center' },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { ...type.bodyMedium, fontSize: 14 },
  chipTextSelected: { color: colors.accentText },
  locate: { flexDirection: 'row', marginTop: 6 },
  center: { textAlign: 'center' },
});

export default function RouteNewScreen() {
  return <Gated><RouteNew /></Gated>;
}
