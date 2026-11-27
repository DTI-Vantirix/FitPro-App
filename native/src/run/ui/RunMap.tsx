/** The maps: the live and summary map (planned route, track so far, the runner), the
 * small preview on a saved-route card, and the map a route is drawn on. The only file
 * that knows which map library is in use.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { thinPoints, type LatLng } from '../geo';
import { pointRole, previewRegion, type PointRole, type Waypoint } from '../route-draft';
import { brand, colors } from '../../theme';
import { fonts } from '../../typography';

type Props = {
  /** Planned route line, when the run follows one. */
  route?: LatLng[];
  /** Where the runner has been. */
  track?: LatLng[];
  /** Follow the runner (live) or fit everything on screen (summary). */
  live: boolean;
  nextTurn?: LatLng | null;
};

/** Google Maps (Android) dark style in brand neutrals. Apple Maps uses userInterfaceStyle instead. */
const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: brand.graphite }] },
  { elementType: 'labels.text.fill', stylers: [{ color: brand.steel }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: brand.ink }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: brand.line }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: brand.ink }] },
];

const toCoord = (p: LatLng) => ({ latitude: p.lat, longitude: p.lng });

/** Apple Maps needs no key. Google Maps on Android does, and must not be created without
 * one, so until the build carries a key the map is replaced by a plain notice. */
export const MAP_AVAILABLE = Platform.OS !== 'android' || Constants.expoConfig?.extra?.androidMapsKeyPresent === true;

export function RunMap({ route = [], track = [], live, nextTurn }: Props) {
  const map = useRef<MapView>(null);
  const routeLine = useMemo(() => route.map(toCoord), [route]);
  const trackLine = useMemo(() => track.map(toCoord), [track]);
  const last = track.length ? track[track.length - 1] : null;
  const anchor = last ?? route[0] ?? null;
  const start = track[0] ?? route[0] ?? null;

  useEffect(() => {
    if (!live || !last) return;
    map.current?.animateCamera({ center: toCoord(last), zoom: 16 }, { duration: 600 });
  }, [live, last?.lat, last?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const fit = () => {
    if (live) return;
    const all = [...routeLine, ...trackLine];
    if (all.length >= 2) map.current?.fitToCoordinates(all, { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: false });
  };

  if (!MAP_AVAILABLE) {
    return <View style={[styles.map, styles.empty, styles.notice]}>
      <Text style={styles.noticeText}>The map is not available in this Android build yet. Your run is still being recorded{route.length >= 2 ? ', and turns and "off route" still work' : ''}.</Text>
    </View>;
  }
  if (!anchor) return <View style={[styles.map, styles.empty]} />;
  return <MapView
    ref={map}
    style={styles.map}
    userInterfaceStyle="dark"
    customMapStyle={DARK_MAP_STYLE}
    showsUserLocation={live}
    showsCompass={false}
    toolbarEnabled={false}
    pitchEnabled={false}
    onMapReady={fit}
    initialRegion={{ ...toCoord(anchor), latitudeDelta: 0.008, longitudeDelta: 0.008 }}>
    {routeLine.length >= 2 && <Polyline coordinates={routeLine} strokeColor={colors.routePlanned} strokeWidth={4} lineJoin="round" lineCap="round" />}
    {trackLine.length >= 2 && <Polyline coordinates={trackLine} strokeColor={colors.accent} strokeWidth={5} lineJoin="round" lineCap="round" />}
    {nextTurn && <Marker coordinate={toCoord(nextTurn)} pinColor={colors.accent} />}
    {start && <Marker coordinate={toCoord(start)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
      <View style={styles.startDot} />
    </Marker>}
    {!live && last && track.length >= 2 && <Marker coordinate={toCoord(last)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
      <View style={styles.finishDot} />
    </Marker>}
  </MapView>;
}

// ---- Saved-route preview ------------------------------------------------------------------

/** A still picture of a route for a list card: no gestures, never moves. Android draws it in
 * lite mode (a bitmap, not a live map), so a list of them stays light. */
export function RoutePreviewMap({ path }: { path: LatLng[] }) {
  const region = useMemo(() => previewRegion(path), [path]);
  const line = useMemo(() => thinPoints(path, 200).map(toCoord), [path]);
  if (!MAP_AVAILABLE || !region || line.length < 2) return <View style={[styles.preview, styles.empty]} />;
  return <View style={styles.preview} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <MapView
      style={StyleSheet.absoluteFill}
      liteMode
      userInterfaceStyle="dark"
      customMapStyle={DARK_MAP_STYLE}
      initialRegion={region}
      scrollEnabled={false}
      zoomEnabled={false}
      rotateEnabled={false}
      pitchEnabled={false}
      showsCompass={false}
      toolbarEnabled={false}>
      <Polyline coordinates={line} strokeColor={colors.accent} strokeWidth={4} lineJoin="round" lineCap="round" />
      <Marker coordinate={line[0]} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
        <View style={styles.startDot} />
      </Marker>
      <Marker coordinate={line[line.length - 1]} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
        <View style={styles.finishDot} />
      </Marker>
    </MapView>
  </View>;
}

// ---- Drawing a route ----------------------------------------------------------------------

/** A waypoint marker: START (Ink, Volt outline), FINISH (solid Volt), or a Chalk dot between.
 * Each sits in a larger clear grip so a finger can pick it up. */
export function RoutePin({ role }: { role: PointRole }) {
  if (role === 'between') return <View style={styles.grip}><View style={styles.betweenDot} /></View>;
  return <View style={styles.pinGrip}>
    <View style={[styles.pin, role === 'start' ? styles.pinStart : styles.pinFinish]}>
      <Text style={[styles.pinText, { color: role === 'start' ? colors.accent : colors.accentText }]}>{role === 'start' ? 'START' : 'FINISH'}</Text>
    </View>
  </View>;
}

/** About the website builder's zoom 15. */
const DRAW_DELTA = 0.012;

type DrawProps = {
  /** Where the map opens. Read once: the map never follows it afterwards. */
  center: LatLng;
  /** A first location fix that arrived after the map opened. Used once, then ignored. */
  recenter?: LatLng | null;
  points: Waypoint[];
  /** The road-following line, when the server has returned one. */
  path: LatLng[];
  showsUser: boolean;
  onAddPoint: (at: LatLng) => void;
  onMovePoint: (index: number, at: LatLng) => void;
};

/** The map a route is drawn on. Tap to add a point; press and hold a point, then drag, to
 * move it. Nothing here moves or zooms the map when points change: there is no `region`
 * prop and no fitting, only `initialRegion` and the single late re-centre. */
export function RouteDrawMap({ center, recenter, points, path, showsUser, onAddPoint, onMovePoint }: DrawProps) {
  const map = useRef<MapView>(null);
  const recentred = useRef(false);
  const opened = useRef(center).current;
  const pathLine = useMemo(() => path.map(toCoord), [path]);
  const pointLine = useMemo(() => points.map(toCoord), [points]);

  useEffect(() => {
    if (!recenter || recentred.current) return;
    recentred.current = true;
    map.current?.animateToRegion({ ...toCoord(recenter), latitudeDelta: DRAW_DELTA, longitudeDelta: DRAW_DELTA }, 0);
  }, [recenter]);

  if (!MAP_AVAILABLE) {
    return <View style={[styles.map, styles.empty, styles.notice]}>
      <Text style={styles.noticeText}>The map is not available in this Android build yet, so a route cannot be drawn here.</Text>
    </View>;
  }
  return <MapView
    ref={map}
    style={styles.map}
    userInterfaceStyle="dark"
    customMapStyle={DARK_MAP_STYLE}
    showsUserLocation={showsUser}
    showsMyLocationButton={false}
    tintColor={colors.accent}
    showsCompass={false}
    toolbarEnabled={false}
    pitchEnabled={false}
    moveOnMarkerPress={false}
    onPress={(event) => {
      const { coordinate, action } = event.nativeEvent;
      if (action === 'marker-press' || !coordinate) return;
      onAddPoint({ lat: coordinate.latitude, lng: coordinate.longitude });
    }}
    initialRegion={{ ...toCoord(opened), latitudeDelta: DRAW_DELTA, longitudeDelta: DRAW_DELTA }}>
    {pathLine.length >= 2
      ? <Polyline coordinates={pathLine} strokeColor={colors.accent} strokeWidth={5} lineJoin="round" lineCap="round" />
      : pointLine.length >= 2
        ? <Polyline coordinates={pointLine} strokeColor={colors.subtle} strokeWidth={3} lineDashPattern={[1, 7]} lineJoin="round" lineCap="round" />
        : null}
    {points.map((point, index) => {
      const role = pointRole(index, points.length);
      // The role is in the key: a point that stops being the finish is drawn afresh as a dot.
      return <Marker key={`${index}-${role}`} coordinate={toCoord(point)} anchor={{ x: 0.5, y: 0.5 }}
        draggable stopPropagation tracksViewChanges={false} zIndex={role === 'between' ? 1 : 2}
        accessibilityLabel={role === 'start' ? 'Start point' : role === 'finish' ? 'Finish point' : `Point ${index + 1}`}
        onDragEnd={(event) => {
          const at = event.nativeEvent.coordinate;
          if (at) onMovePoint(index, { lat: at.latitude, lng: at.longitude });
        }}>
        <RoutePin role={role} />
      </Marker>;
    })}
  </MapView>;
}

const styles = StyleSheet.create({
  preview: { height: 144, borderRadius: 14, overflow: 'hidden' },
  grip: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  betweenDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: brand.chalk, borderWidth: 3, borderColor: brand.ink },
  pinGrip: { width: 62, height: 40, justifyContent: 'center' },
  pin: { height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  pinStart: { backgroundColor: brand.ink, borderColor: brand.volt },
  pinFinish: { backgroundColor: brand.volt, borderColor: brand.volt },
  pinText: { fontFamily: fonts.bodyStrong, fontSize: 9, lineHeight: 12, letterSpacing: 0.9 },
  map: { flex: 1, minHeight: 180, borderRadius: 14, overflow: 'hidden' },
  empty: { backgroundColor: colors.panel, borderColor: colors.panelBorder, borderWidth: 1 },
  startDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.background, borderWidth: 2.5, borderColor: colors.accent },
  finishDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.accent },
  notice: { alignItems: 'center', justifyContent: 'center', padding: 20 },
  noticeText: { color: colors.muted, fontSize: 14, lineHeight: 21, textAlign: 'center' },
});
