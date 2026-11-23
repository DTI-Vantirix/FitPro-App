import { BackgroundSchedulerDiagnosticPanel } from '../src/ingestion/background-scheduler-diagnostic-panel';
import { BackgroundHealthReadDiagnosticPanel } from '../src/ingestion/background-health-read-diagnostic-panel';
import { BackgroundSyncPilotPanel } from '../src/ingestion/background-sync-pilot-panel';
import { BackgroundReadinessPanel } from '../src/ingestion/background-readiness-panel';
import { ManualImportPanel } from '../src/ingestion/manual-import-panel';
import React, { useEffect, useMemo, useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../src/auth/session';
import { useAccessGate } from '../src/access/access-gate';
import { Action, ErrorNotice, SectionHeading } from '../src/components/Ui';
import { getHealthAdapter, isAppleHealthBuildAvailable, isAndroidHealthBuildAvailable,
  type NormalizedActivity, type NormalizedRun, type NormalizedWorkout } from '../src/health';
import { colors } from '../src/theme';

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'Invalid activity date' : date.toLocaleString();
}

function duration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

function RunDetails({ item, fake }: { item: NormalizedRun; fake: boolean }) {
  return <>
    <Text style={styles.itemTitle}>{item.routeName}</Text>
    <Text style={styles.itemMeta}>{when(item.startedAt)}</Text>
    <Text style={styles.data}>{item.distanceMi.toFixed(2)} mi   ·   {duration(item.durationSec)}</Text>
    {item.avgHr != null && <Text style={styles.itemMeta}>Avg HR {item.avgHr} bpm{item.maxHr != null ? ` · Max ${item.maxHr} bpm` : ''}</Text>}
    {!!item.points?.length && <Text style={styles.itemMeta}>GPS route: {item.points.length} points (not uploaded)</Text>}
    {!!item.splits?.length && <Text style={styles.itemMeta}>{item.splits.length} {fake ? 'simulated ' : ''}whole-mile split(s)</Text>}
  </>;
}

function WorkoutDetails({ item }: { item: NormalizedWorkout }) {
  return <>
    <Text style={styles.itemTitle}>{item.name}</Text>
    <Text style={styles.itemMeta}>{when(item.performedAt)}</Text>
    <Text style={styles.data}>{item.exercises.length} exercises{item.durationMin != null ? `   ·   ${item.durationMin} min` : ''}</Text>
    {item.exercises.map((exercise, index) => (
      <Text style={styles.itemMeta} key={`${exercise.name}-${index}`}>
        {exercise.name}: {exercise.sets.map((set) => `${set.reps} × ${set.weight} lb`).join(' / ')}
      </Text>
    ))}
  </>;
}

function ActivityCard({ item, fake }: { item: NormalizedActivity; fake: boolean }) {
  return <View style={styles.card}>
    <View style={styles.cardHeader}>
      <Text style={styles.kind}>{item.kind === 'run' ? 'RUN' : 'STRENGTH'}</Text>
      <Text style={styles.source}>{fake ? 'FAKE · ' : 'READ ONLY · '}{item.source.toUpperCase()}</Text>
    </View>
    {item.kind === 'run' ? <RunDetails item={item} fake={fake} /> : <WorkoutDetails item={item} />}
    <Text style={styles.externalId} selectable>External ID: {item.externalId}</Text>
  </View>;
}

type Provider = 'fake' | 'apple' | 'health_connect';

export default function ActivitiesScreen() {
  const router = useRouter();
  const { accessToken, loadingSession, consentAccepted, sessionError } = useSession();
  const { status: accessStatus, error: accessError, refresh } = useAccessGate();
  const authorized = Boolean(accessToken && consentAccepted && accessStatus === 'allowed');
  const [provider, setProvider] = useState<Provider>('fake');
  const [realPermissionRequestComplete, setRealPermissionRequestComplete] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [items, setItems] = useState<ReadonlyArray<NormalizedActivity>>([]);
  const [warnings, setWarnings] = useState<ReadonlyArray<string>>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [readCount, setReadCount] = useState(0);
  const [hasRead, setHasRead] = useState(false);
  const [lastSuccessfulRead, setLastSuccessfulRead] = useState<{ number: number; count: number; completedAt: string } | null>(null);
  const adapter = getHealthAdapter(provider);
  const canRead = authorized && (provider === 'fake' || realPermissionRequestComplete);
  const fake = provider === 'fake';

  useEffect(() => {
    if (!canRead) {
      setItems([]);
      setWarnings([]);
      setHasRead(false);
      setLoading(false);
      setLastSuccessfulRead(null);
      return;
    }
    let active = true;
    setLoadError(null);
    setLoading(true);
    adapter.readActivities()
      .then((result) => {
        if (!active) return;
        setItems(result);
        setWarnings(adapter.getReadWarnings?.() ?? []);
        setHasRead(true);
        setLastSuccessfulRead({ number: readCount + 1, count: result.length, completedAt: new Date().toLocaleTimeString() });
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setLoadError(cause instanceof Error ? cause.message : String(cause));
        setHasRead(true);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [canRead, adapter, readCount]);

  const totals = useMemo(() => ({
    runs: items.filter((item) => item.kind === 'run').length,
    workouts: items.filter((item) => item.kind === 'workout').length,
  }), [items]);

  function chooseProvider(next: Provider) {
    if (!authorized || permissionBusy) return;
    setProvider(next);
    setItems([]);
    setWarnings([]);
    setReadCount(0);
    setLastSuccessfulRead(null);
    setLoadError(null);
    setHasRead(false);
    if (next !== 'fake') setRealPermissionRequestComplete(false);
  }

  async function requestRealPermission() {
    if (!authorized || provider === 'fake' || permissionBusy) return;
    if (provider === 'apple' && !isAppleHealthBuildAvailable()) {
      setLoadError('Apple Health requires a FitPro iOS development build. Expo Go cannot access HealthKit.');
      return;
    }
    if (provider === 'health_connect' && !isAndroidHealthBuildAvailable()) {
      setLoadError('Android Health Connect requires a FitPro Android development build. Expo Go cannot access its native module.');
      return;
    }
    setPermissionBusy(true);
    setLoadError(null);
    try {
      if (!adapter.requestReadAuthorization) throw new Error('This provider has no read-permission flow.');
      await adapter.requestReadAuthorization();
      setRealPermissionRequestComplete(true);
    } catch (cause) {
      setRealPermissionRequestComplete(false);
      setLoadError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPermissionBusy(false);
    }
  }

  if (loadingSession) return <View style={styles.loading}><ActivityIndicator color={colors.accent} /></View>;
  if (!accessToken) return <Redirect href="/" />;
  if (!consentAccepted) return <Redirect href="/consent" />;
  if (accessStatus === 'needs_invite' || accessStatus === 'blocked') return <Redirect href="/invite" />;

  return <ScrollView style={styles.root} contentContainerStyle={styles.content}>
    <Text style={styles.brand}>FITPRO / NATIVE</Text>
    {accessStatus !== 'allowed' ? <>
      <SectionHeading kicker="STEP 02 · ACCESS REQUIRED" title="Access not verified."
        subtitle="Health reads remain disabled until Base44 confirms your invite authorization." />
      <ErrorNotice message={accessError ?? sessionError} />
      {accessStatus === 'checking'
        ? <ActivityIndicator color={colors.accent} />
        : <Action label="Retry invite verification" onPress={() => { void refresh(); }} />}
    </> : <>
      <SectionHeading kicker="STEP 05 · HEALTH ADAPTER" title="Your activities."
        subtitle="Choose sample records or read running workouts from your phone. Health data stays on the device unless you explicitly enable foreground auto-import or select a manual import." />
      <Action label="Sample activities (offline)" onPress={() => chooseProvider('fake')} disabled={fake || permissionBusy} secondary />
      {Platform.OS === 'ios' && <Action label="Apple Health (read-only)" onPress={() => chooseProvider('apple')} disabled={provider === 'apple' || permissionBusy} secondary />}
      {Platform.OS === 'android' && <Action label="Health Connect (read-only)" onPress={() => chooseProvider('health_connect')} disabled={provider === 'health_connect' || permissionBusy} secondary />}
      <View style={styles.banner}>
        <Text style={styles.bannerTitle}>{fake ? 'OFFLINE SIMULATION' : provider === 'apple' ? 'APPLE HEALTH · READ ONLY' : 'HEALTH CONNECT · READ ONLY'}</Text>
        <Text style={styles.bannerBody}>Adapter: {adapter.displayName}</Text>
        <Text style={styles.bannerBody}>Consent: accepted · Base44 invite: verified</Text>
        <Text style={styles.bannerBody}>{fake ? 'OS health permissions: NOT REQUESTED' : realPermissionRequestComplete
          ? provider === 'apple' ? 'Health permission request completed (Apple does not disclose which read types were granted).' : 'Health Connect: required read permissions verified.'
          : 'OS health permission: NOT REQUESTED in this screen'}</Text>
        <Text style={styles.bannerBody}>Activity uploads: MANUAL / OPTIONAL FOREGROUND AUTO (FAKE DISABLED)</Text>
        <Text accessibilityLiveRegion="polite" style={styles.bannerStatus}>
          {loading ? 'Reading activities…' : lastSuccessfulRead
            ? `Last successful read: #${lastSuccessfulRead.number} · ${lastSuccessfulRead.count} activities`
            : 'Waiting for an adapter read'}
        </Text>
      </View>
      {!fake && <>
        <Text style={styles.note}>Only running workouts are displayed. Neither Apple Health nor Health Connect normally provides the per-exercise sets, reps, and weights required by FitPro's strength-ingestion contract.</Text>
        {provider === 'apple'
          ? <Text style={styles.note}>Workouts, running distance, routes and heart rate are read only with your approval. Routes and heart rate are optional; Apple may return no data for denied read types.</Text>
          : <Text style={styles.note}>Health Connect reads running and treadmill sessions from the last 30 days. Exercise and distance access are required; heart rate is optional. Another app's GPS routes need separate permission, which this screen does not request.</Text>}
        {!realPermissionRequestComplete && <Action
          label={permissionBusy ? 'Opening OS health permissions…' : `Request ${provider === 'apple' ? 'Apple Health' : 'Health Connect'} read access`}
          busy={permissionBusy} onPress={() => { void requestRealPermission(); }} />}
      </>}
      {loading && <View style={styles.reading}><ActivityIndicator color={colors.accent} /><Text style={styles.itemMeta}>Reading {fake ? 'sample' : adapter.displayName} activities…</Text></View>}
      <ErrorNotice message={loadError ?? sessionError} />
      {warnings.length > 0 && <View style={styles.notice}>
        <Text style={styles.noticeTitle}>Read details</Text>
        {warnings.map((warning, index) => <Text key={`${index}:${warning}`} style={styles.noticeText} selectable>{warning}</Text>)}
      </View>}
      {hasRead && !loadError && <>
        <Text style={styles.count}>{items.length} activities  ·  {totals.runs} runs  ·  {totals.workouts} strength</Text>
        {items.length === 0 && <Text style={styles.itemMeta}>{fake ? 'The fake provider returned no activities.' : `No readable running workouts were returned. Check ${provider === 'apple' ? 'Apple Health' : 'Health Connect'} permissions and workout history.`}</Text>}
        {items.map((item) => <ActivityCard key={`${item.source}:${item.externalId}`} item={item} fake={fake} />)}
      </>}
      <ManualImportPanel activities={items} adapterId={adapter.id} authorized={authorized && hasRead && !loading && !loadError} readWarnings={warnings} onForegroundResume={() => setReadCount((value) => value + 1)} />
      <BackgroundReadinessPanel provider={adapter.id} signedIn={Boolean(accessToken)} consentAccepted={consentAccepted} inviteVerified={accessStatus === 'allowed'} />
      <BackgroundSchedulerDiagnosticPanel provider={adapter.id} signedIn={Boolean(accessToken)} consentAccepted={consentAccepted} inviteVerified={accessStatus === 'allowed'} />
      <BackgroundHealthReadDiagnosticPanel provider={adapter.id} signedIn={Boolean(accessToken)} consentAccepted={consentAccepted} inviteVerified={accessStatus === 'allowed'} />
      <BackgroundSyncPilotPanel provider={adapter.id} signedIn={Boolean(accessToken)} consentAccepted={consentAccepted} inviteVerified={accessStatus === 'allowed'} />
      <View style={styles.reloadFeedback} accessibilityLiveRegion="polite">
        {loading ? <Text style={styles.readingStatus}>Reload in progress…</Text>
          : loadError ? <Text style={styles.readingError}>Read failed. Error details are shown above.</Text>
          : lastSuccessfulRead ? <>
              <Text style={styles.readingSuccess}>✓ Adapter read #{lastSuccessfulRead.number} completed</Text>
              <Text style={styles.readingDetail}>{lastSuccessfulRead.count} activities loaded · {lastSuccessfulRead.completedAt}</Text>
              {fake && <Text style={styles.readingHint}>The four fake records are identical after each reload.</Text>}
            </> : <Text style={styles.readingStatus}>No reads completed yet.</Text>}
      </View>
      <Action label={loading ? 'Reloading activities…' : `Reload ${fake ? 'fake' : provider === 'apple' ? 'Apple Health' : 'Health Connect'} activities`}
        onPress={() => setReadCount((value) => value + 1)} busy={loading} disabled={!canRead || permissionBusy} secondary />
    </>}
    <Action label="Back to ingestion test" onPress={() => router.replace('/spike')} secondary />
  </ScrollView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 24, paddingTop: 40, paddingBottom: 64 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  brand: { color: colors.text, fontSize: 14, letterSpacing: 3, fontWeight: '900', marginBottom: 40 },
  banner: { backgroundColor: '#19352F', borderWidth: 1, borderColor: colors.accent, borderRadius: 14, padding: 16, marginTop: 14, marginBottom: 18, gap: 7 },
  bannerTitle: { color: colors.accent, fontWeight: '900', letterSpacing: 1.3, fontSize: 12 },
  bannerBody: { color: colors.text, fontSize: 12, lineHeight: 19 },
  bannerStatus: { color: colors.accent, fontSize: 12, fontWeight: '800', marginTop: 6 },
  note: { color: colors.muted, fontSize: 12, lineHeight: 20, marginBottom: 11 },
  notice: { backgroundColor: colors.panel, borderColor: '#8E7E54', borderWidth: 1, borderRadius: 14, padding: 14, marginVertical: 10, gap: 8 },
  noticeTitle: { fontSize: 13, fontWeight: '800', color: colors.text },
  noticeText: { fontSize: 12, color: colors.muted, lineHeight: 20 },
  reloadFeedback: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder, borderRadius: 12, padding: 14, marginTop: 12, marginBottom: 8, gap: 4 },
  readingSuccess: { color: colors.accent, fontWeight: '800', fontSize: 14 },
  readingDetail: { color: colors.text, fontSize: 12 },
  readingHint: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  readingStatus: { color: colors.text, fontSize: 13 },
  readingError: { color: colors.danger, fontSize: 13 },
  count: { color: colors.muted, fontSize: 13, marginVertical: 16, fontWeight: '700' },
  reading: { minHeight: 110, alignItems: 'center', justifyContent: 'center', gap: 12 },
  card: { borderWidth: 1, borderColor: colors.panelBorder, backgroundColor: colors.panel, borderRadius: 14, padding: 17, marginBottom: 13, gap: 7 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  kind: { color: colors.accent, fontSize: 11, letterSpacing: 2, fontWeight: '900' },
  source: { color: colors.subtle, fontSize: 10, letterSpacing: 1, fontWeight: '700' },
  itemTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  itemMeta: { color: colors.muted, fontSize: 13, lineHeight: 21 },
  data: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 7 },
  externalId: { color: colors.subtle, fontSize: 11, marginTop: 12 },
});
