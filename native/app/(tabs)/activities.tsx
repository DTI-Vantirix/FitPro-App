import { BackgroundSchedulerDiagnosticPanel } from '../../src/ingestion/background-scheduler-diagnostic-panel';
import { BackgroundHealthReadDiagnosticPanel } from '../../src/ingestion/background-health-read-diagnostic-panel';
import { BackgroundSyncPilotPanel } from '../../src/ingestion/background-sync-pilot-panel';
import { BackgroundReadinessPanel } from '../../src/ingestion/background-readiness-panel';
import { ManualImportPanel } from '../../src/ingestion/manual-import-panel';
import React, { useEffect, useMemo, useState } from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../../src/auth/session';
import { useAccessGate } from '../../src/access/access-gate';
import { Action, Card, ErrorNotice, Heading, Label, Screen, ScreenHeader, SectionHeading } from '../../src/components/Ui';
import { getHealthAdapter, isAppleHealthBuildAvailable, isAndroidHealthBuildAvailable,
  type NormalizedActivity, type NormalizedRun, type NormalizedWorkout } from '../../src/health';
import { AUTO_HEALTH_IMPORT_ENABLED } from '../../src/ingestion/auto-import-policy';
import { colors } from '../../src/theme';
import { heading, stat, type } from '../../src/typography';

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
    <Text style={styles.data}>{item.distanceMi.toFixed(2)} mi · {duration(item.durationSec)}</Text>
    {item.avgHr != null && <Text style={styles.itemMeta}>Avg HR {item.avgHr} bpm{item.maxHr != null ? ` · Max ${item.maxHr} bpm` : ''}</Text>}
    {!!item.points?.length && <Text style={styles.itemMeta}>GPS route: {item.points.length} points (not uploaded)</Text>}
    {!!item.splits?.length && <Text style={styles.itemMeta}>{item.splits.length} {fake ? 'simulated ' : ''}whole-mile split(s)</Text>}
  </>;
}

function WorkoutDetails({ item }: { item: NormalizedWorkout }) {
  return <>
    <Text style={styles.itemTitle}>{item.name}</Text>
    <Text style={styles.itemMeta}>{when(item.performedAt)}</Text>
    <Text style={styles.data}>{item.exercises.length} exercises{item.durationMin != null ? ` · ${item.durationMin} min` : ''}</Text>
    {item.exercises.map((exercise, index) => (
      <Text style={styles.itemMeta} key={`${exercise.name}-${index}`}>
        {exercise.name}: {exercise.sets.map((set) => `${set.reps} × ${set.weight} lb`).join(' / ')}
      </Text>
    ))}
  </>;
}

function ActivityCard({ item, fake }: { item: NormalizedActivity; fake: boolean }) {
  return <Card>
    <View style={styles.cardHeader}>
      <Text style={styles.kind}>{item.kind === 'run' ? 'Run' : 'Strength'}</Text>
      <Label>{fake ? 'Sample · ' : 'Read only · '}{item.source}</Label>
    </View>
    {item.kind === 'run' ? <RunDetails item={item} fake={fake} /> : <WorkoutDetails item={item} />}
    <Text style={styles.externalId} selectable>ID: {item.externalId}</Text>
  </Card>;
}

type Provider = 'fake' | 'apple' | 'health_connect';

export default function ActivitiesScreen() {
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
      setLoadError('Apple Health requires a VantraRun iOS development build. Expo Go cannot access HealthKit.');
      return;
    }
    if (provider === 'health_connect' && !isAndroidHealthBuildAvailable()) {
      setLoadError('Android Health Connect requires a VantraRun Android development build. Expo Go cannot access its native module.');
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

  return <Screen>
    <ScreenHeader />
    {accessStatus !== 'allowed' ? <>
      <SectionHeading kicker="Activities" title="Access not confirmed"
        subtitle="Health reads stay off until VantraRun confirms your invite." />
      <ErrorNotice message={accessError ?? sessionError} />
      {accessStatus === 'checking'
        ? <ActivityIndicator color={colors.accent} />
        : <Action label="Check access again" onPress={() => { void refresh(); }} />}
    </> : <>
      <SectionHeading kicker="Import from health" title="Your activities"
        subtitle="Read running workouts from your phone, or look at sample records. Health data stays on this phone unless you choose a run to import." />
      <Label style={styles.sectionLabel}>Source</Label>
      <View style={styles.chips}>
        <Chip label="Samples" selected={fake} disabled={permissionBusy} onPress={() => chooseProvider('fake')} />
        {Platform.OS === 'ios' && <Chip label="Apple Health" selected={provider === 'apple'} disabled={permissionBusy} onPress={() => chooseProvider('apple')} />}
        {Platform.OS === 'android' && <Chip label="Health Connect" selected={provider === 'health_connect'} disabled={permissionBusy} onPress={() => chooseProvider('health_connect')} />}
      </View>
      <Card>
        <Heading size={16}>{fake ? 'Sample records' : provider === 'apple' ? 'Apple Health, read only' : 'Health Connect, read only'}</Heading>
        <Text style={styles.itemMeta}>Source: {adapter.displayName}</Text>
        <Text style={styles.itemMeta}>{fake ? 'No health permission is asked for.' : realPermissionRequestComplete
          ? provider === 'apple' ? 'Health permission request completed (Apple does not disclose which read types were granted).' : 'Health Connect: required read permissions verified.'
          : 'Health permission has not been asked for yet.'}</Text>
        <Text style={styles.itemMeta}>Nothing is uploaded unless you import it by hand. Samples are never uploaded.</Text>
        <Text accessibilityLiveRegion="polite" style={styles.status}>
          {loading ? 'Reading activities…' : lastSuccessfulRead
            ? `Last successful read: #${lastSuccessfulRead.number} · ${lastSuccessfulRead.count} activities`
            : 'Waiting for a first read'}
        </Text>
      </Card>
      {!fake && <>
        <Text style={styles.note}>Only running workouts are shown. Neither Apple Health nor Health Connect normally provides the per-exercise sets, reps and weights VantraRun needs for strength sessions.</Text>
        {provider === 'apple'
          ? <Text style={styles.note}>Workouts, running distance, routes and heart rate are read only with your approval. Routes and heart rate are optional; Apple may return no data for denied read types.</Text>
          : <Text style={styles.note}>Health Connect reads running and treadmill sessions from the last 30 days. Exercise and distance access are required; heart rate is optional. Another app's GPS routes need separate permission, which this screen does not request.</Text>}
        {!realPermissionRequestComplete && <Action
          label={permissionBusy ? 'Opening health permissions…' : `Allow ${provider === 'apple' ? 'Apple Health' : 'Health Connect'} read access`}
          busy={permissionBusy} onPress={() => { void requestRealPermission(); }} />}
      </>}
      {loading && <View style={styles.reading}><ActivityIndicator color={colors.accent} /><Text style={styles.itemMeta}>Reading {fake ? 'sample' : adapter.displayName} activities…</Text></View>}
      <ErrorNotice message={loadError ?? sessionError} />
      {warnings.length > 0 && <Card>
        <Heading size={16}>Read details</Heading>
        {warnings.map((warning, index) => <Text key={`${index}:${warning}`} style={styles.itemMeta} selectable>{warning}</Text>)}
      </Card>}
      {hasRead && !loadError && <>
        <Label style={styles.sectionLabel}>{items.length} activities · {totals.runs} runs · {totals.workouts} strength</Label>
        {items.length === 0 && <Text style={styles.itemMeta}>{fake ? 'There are no sample activities.' : `No readable running workouts were returned. Check ${provider === 'apple' ? 'Apple Health' : 'Health Connect'} permissions and workout history.`}</Text>}
        {items.map((item) => <ActivityCard key={`${item.source}:${item.externalId}`} item={item} fake={fake} />)}
      </>}
      <ManualImportPanel activities={items} adapterId={adapter.id} authorized={authorized && hasRead && !loading && !loadError} readWarnings={warnings} onForegroundResume={() => setReadCount((value) => value + 1)} />
      {AUTO_HEALTH_IMPORT_ENABLED && <>
      <BackgroundReadinessPanel provider={adapter.id} signedIn={Boolean(accessToken)} consentAccepted={consentAccepted} inviteVerified={accessStatus === 'allowed'} />
      <BackgroundSchedulerDiagnosticPanel provider={adapter.id} signedIn={Boolean(accessToken)} consentAccepted={consentAccepted} inviteVerified={accessStatus === 'allowed'} />
      <BackgroundHealthReadDiagnosticPanel provider={adapter.id} signedIn={Boolean(accessToken)} consentAccepted={consentAccepted} inviteVerified={accessStatus === 'allowed'} />
      <BackgroundSyncPilotPanel provider={adapter.id} signedIn={Boolean(accessToken)} consentAccepted={consentAccepted} inviteVerified={accessStatus === 'allowed'} />
      </>}
      <Card style={styles.reloadFeedback}>
        <View accessibilityLiveRegion="polite" style={styles.reloadText}>
          {loading ? <Text style={styles.itemMeta}>Reload in progress…</Text>
            : loadError ? <Text style={styles.readingError}>Read failed. Error details are shown above.</Text>
            : lastSuccessfulRead ? <>
                <Text style={styles.status}>Adapter read #{lastSuccessfulRead.number} completed</Text>
                <Text style={styles.itemMeta}>{lastSuccessfulRead.count} activities loaded · {lastSuccessfulRead.completedAt}</Text>
                {fake && <Text style={styles.itemMeta}>The four sample records are the same after each reload.</Text>}
              </> : <Text style={styles.itemMeta}>No reads completed yet.</Text>}
        </View>
        <Action label={loading ? 'Reloading activities…' : `Reload ${fake ? 'sample' : provider === 'apple' ? 'Apple Health' : 'Health Connect'} activities`}
          onPress={() => setReadCount((value) => value + 1)} busy={loading} disabled={!canRead || permissionBusy} secondary />
      </Card>
    </>}
  </Screen>;
}

function Chip({ label, selected, disabled, onPress }: { label: string; selected: boolean; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ selected, disabled }} disabled={disabled || selected} onPress={onPress}
    style={[styles.chip, selected && styles.chipSelected]}>
    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sectionLabel: { marginTop: 6, marginBottom: 10, paddingHorizontal: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: { borderWidth: 1, borderColor: colors.panelBorder, borderRadius: 999, paddingHorizontal: 16, minHeight: 40, justifyContent: 'center' },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { ...type.bodyMedium, fontSize: 14 },
  chipTextSelected: { color: colors.accentText },
  status: { ...type.bodyStrong, fontSize: 14, color: colors.accent },
  note: { ...type.small, marginBottom: 10, paddingHorizontal: 4 },
  reloadFeedback: { marginTop: 4 },
  reloadText: { gap: 4 },
  readingError: { ...type.body, color: colors.danger },
  reading: { minHeight: 110, alignItems: 'center', justifyContent: 'center', gap: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kind: { ...type.label, color: colors.accent },
  itemTitle: { ...heading(18) },
  itemMeta: { ...type.body, fontSize: 14, lineHeight: 21 },
  data: { ...stat(26), marginTop: 2 },
  externalId: { ...type.small, fontSize: 11, marginTop: 6 },
});
