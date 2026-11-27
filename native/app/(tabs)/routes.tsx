import React, { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../../src/auth/session';
import { Action, Card, ErrorNotice, Heading, Label, Notice, StatRow } from '../../src/components/Ui';
import { deleteRoute, listRoutes, type SavedRoute } from '../../src/run/api';
import { deviceCache } from '../../src/run/device/run-files';
import { RoutePreviewMap } from '../../src/run/ui/RunMap';
import { Brand, Gated } from '../../src/run/ui/Screen';
import { useRunAccount } from '../../src/run/use-run';
import { colors } from '../../src/theme';
import { display, type } from '../../src/typography';

const words = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

function RouteCard({ route, deleting, onStart, onDelete }: { route: SavedRoute; deleting: boolean; onStart: () => void; onDelete: () => void }) {
  return <Card>
    <RoutePreviewMap path={route.path} />
    <Heading>{route.name}</Heading>
    <StatRow size={24} items={[
      { label: 'Distance', value: route.distanceMi != null ? route.distanceMi.toFixed(2) : '–', unit: 'mi' },
      { label: 'Target zone', value: route.targetZoneName ?? '–' },
    ]} />
    <View style={local.buttons}>
      <View style={local.grow}><Action label="Start run" icon="play" compact disabled={deleting} onPress={onStart} /></View>
      <Action label="Delete" icon="trash-2" variant="danger" compact busy={deleting} onPress={onDelete} />
    </View>
  </Card>;
}

function Routes() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { accessToken } = useSession();
  const { ownerId } = useRunAccount();
  const [routes, setRoutes] = useState<SavedRoute[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const loadId = useRef(0);

  const load = useCallback(async () => {
    if (!accessToken || !ownerId) return;
    const id = loadId.current + 1;
    loadId.current = id;
    try {
      const list = await listRoutes(accessToken, ownerId);
      // The same copy run-start falls back to when there is no connection.
      void deviceCache.write(`routes-${ownerId}`, list);
      if (id !== loadId.current) return;
      setRoutes(list);
      setError(null);
      setStale(false);
    } catch (cause) {
      const cached = await deviceCache.read<SavedRoute[]>(`routes-${ownerId}`);
      if (id !== loadId.current) return;
      setError(words(cause));
      setRoutes((current) => current ?? (Array.isArray(cached) ? cached : []));
      setStale(true);
    }
  }, [accessToken, ownerId]);

  // Reloads every time the tab is shown, so a route just saved in the builder is there.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function remove(route: SavedRoute) {
    if (!accessToken || !ownerId) return;
    setDeletingId(route.id);
    setError(null);
    try {
      await deleteRoute(accessToken, route.id);
      loadId.current += 1; // a list still on its way would bring the route back
      const next = (routes ?? []).filter((item) => item.id !== route.id);
      setRoutes(next);
      void deviceCache.write(`routes-${ownerId}`, next);
    } catch (cause) {
      setError(`"${route.name}" was not deleted. ${words(cause)}`);
    } finally {
      setDeletingId(null);
    }
  }

  function confirmDelete(route: SavedRoute) {
    Alert.alert(`Delete "${route.name}"?`, 'The route is removed from your account, here and on the website. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { void remove(route); } },
    ]);
  }

  const draw = () => router.push('/route-new');
  const list = routes ?? [];

  return <FlatList
    style={local.root}
    contentContainerStyle={[local.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}
    data={list}
    keyExtractor={(item) => item.id}
    // Each card holds a small map; only the cards near the screen are kept mounted.
    initialNumToRender={3}
    maxToRenderPerBatch={2}
    windowSize={3}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={colors.accent}
      colors={[colors.accentText]} progressBackgroundColor={colors.accent} />}
    ListHeaderComponent={<>
      <Brand />
      <View style={local.titleRow}>
        <View style={local.titleText}>
          <Label>Mapped on the map</Label>
          <Text accessibilityRole="header" style={display(36)}>Routes</Text>
        </View>
        {list.length > 0 && <Action label="Draw a route" icon="plus" compact onPress={draw} />}
      </View>
      <ErrorNotice message={error} />
      {stale && list.length > 0 && <Notice>These are the routes saved on this phone the last time VantraRun could load them. Pull down to try again.</Notice>}
    </>}
    ListEmptyComponent={routes === null
      ? <View style={local.loading}><ActivityIndicator color={colors.accent} /><Text style={type.body}>Loading your routes…</Text></View>
      : error
        ? <Action label="Try again" secondary onPress={() => { void refresh(); }} busy={refreshing} />
        : <Card style={local.empty}>
          <Heading style={local.center}>No routes yet</Heading>
          <Text style={[type.body, local.center]}>Draw a route once, set the zone, and every run starts from it.</Text>
          <Action label="Draw a route" icon="plus" onPress={draw} />
        </Card>}
    renderItem={({ item }) => <RouteCard route={item} deleting={deletingId === item.id}
      onStart={() => router.push({ pathname: '/run-start', params: { route: item.id } })}
      onDelete={() => confirmDelete(item)} />}
  />;
}

const local = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, paddingHorizontal: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 20, paddingHorizontal: 4 },
  titleText: { flexShrink: 1, gap: 8 },
  loading: { alignItems: 'center', gap: 12, paddingVertical: 48 },
  empty: { alignItems: 'stretch', paddingVertical: 28, gap: 12 },
  center: { textAlign: 'center' },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  grow: { flex: 1 },
});

export default function RoutesScreen() {
  return <Gated><Routes /></Gated>;
}
