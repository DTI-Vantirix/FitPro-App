/** The map on the live and summary screens: the planned route, the track so far and
 * the runner. The only file that knows which map library is in use.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import MapView, { Marker, Polyline } from 'react-native-maps';
import type { LatLng } from '../geo';
import { colors } from '../../theme';

type Props = {
  /** Planned route line, when the run follows one. */
  route?: LatLng[];
  /** Where the runner has been. */
  track?: LatLng[];
  /** Follow the runner (live) or fit everything on screen (summary). */
  live: boolean;
  nextTurn?: LatLng | null;
};

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
    showsUserLocation={live}
    showsCompass={false}
    toolbarEnabled={false}
    pitchEnabled={false}
    onMapReady={fit}
    initialRegion={{ ...toCoord(anchor), latitudeDelta: 0.008, longitudeDelta: 0.008 }}>
    {routeLine.length >= 2 && <Polyline coordinates={routeLine} strokeColor="#6FA8FF" strokeWidth={5} />}
    {trackLine.length >= 2 && <Polyline coordinates={trackLine} strokeColor={colors.accent} strokeWidth={4} />}
    {nextTurn && <Marker coordinate={toCoord(nextTurn)} pinColor="#FFC24B" />}
  </MapView>;
}

const styles = StyleSheet.create({
  map: { flex: 1, minHeight: 180, borderRadius: 14, overflow: 'hidden' },
  empty: { backgroundColor: colors.panel, borderColor: colors.panelBorder, borderWidth: 1 },
  notice: { alignItems: 'center', justifyContent: 'center', padding: 20 },
  noticeText: { color: colors.muted, fontSize: 14, lineHeight: 21, textAlign: 'center' },
});
