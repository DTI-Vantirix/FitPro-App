/** Step 7B.2C: deliberately separate user authorization for background UPLOADS. */
import React, { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Action } from '../components/Ui';
import { colors } from '../theme';
import { inspectAndroidBackgroundSync, type PilotInspection } from './background-sync-inspection';
import { enableBackgroundSyncPilot, disableBackgroundSyncPilot,
  backgroundSyncPilotStatus, triggerBackgroundSyncPilotForTesting, type PilotStatus } from './background-sync-pilot';

type Props = Readonly<{
  provider: 'apple' | 'health_connect' | 'fake';
  signedIn: boolean; consentAccepted: boolean; inviteVerified: boolean;
}>;
export function BackgroundSyncPilotPanel({ provider, signedIn, consentAccepted, inviteVerified }: Props) {
  const [status, setStatus] = useState<PilotStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [inspection, setInspection] = useState<PilotInspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const realProvider = provider === 'apple' ? 'apple' : provider === 'health_connect' ? 'health_connect' : null;
  const matches = (Platform.OS === 'ios' && realProvider === 'apple') ||
    (Platform.OS === 'android' && realProvider === 'health_connect');
  const authorized = signedIn && consentAccepted && inviteVerified && matches;
  const refresh = useCallback(async () => { setStatus(await backgroundSyncPilotStatus()); }, []);
  useEffect(() => {
    let alive = true;
    void backgroundSyncPilotStatus().then((current) => { if (alive) setStatus(current); })
      .catch((cause: unknown) => { if (alive) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { alive = false; };
  }, []);
  async function action(which: 'enable' | 'disable' | 'trigger' | 'refresh' | 'inspect') {
    if (busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      if (which === 'inspect') {
        if (!status?.enabledAt || status.provider !== 'health_connect' || !authorized)
          throw new Error('Sign in, grant consent, and enable Android Health Connect background pilot first.');
        setInspection(await inspectAndroidBackgroundSync(status.enabledAt));
        setMessage('Local, read-only Health Connect inspection complete. No upload attempted.');
      } else if (which === 'enable') {
        if (!authorized || !realProvider)
          throw new Error('Sign in, accept consent, verify invite, and select the real OS health provider.');
        await enableBackgroundSyncPilot(realProvider);
        setMessage('Background upload opt-in enabled. Only NEW running workouts completed after this moment qualify. One run maximum per OS execution.');
      } else if (which === 'disable') {
        await disableBackgroundSyncPilot();
        setMessage('Background uploads disabled. Local background receipts and report cleared.');
      } else if (which === 'trigger') {
        await triggerBackgroundSyncPilotForTesting();
        setMessage('Development worker trigger requested. Refresh to see the actual result. A null trigger return is not a failure.');
      }
      await refresh();
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  const last = status?.last;
  return <View style={styles.panel}>
    <Text style={styles.kicker}>STEP 7B.2C · CONTROLLED BACKGROUND SYNC PILOT</Text>
    <Text style={styles.title}>Background import of new running workouts</Text>
    <Text style={styles.copy}>OFF by default and separate from foreground auto-import. Enabling permits FitPro to send newly completed Apple Health / Health Connect runs to your FitPro account when the operating system schedules this app. Uploaded details include running distance, duration, date, and a generic run name. This pilot does NOT upload GPS routes, heart rate or strength exercises. Maximum ONE run per worker execution, no historical backfill, and no automatic retries after an upload error.</Text>
    <Text style={styles.info}>Scheduler: {status?.available ? 'AVAILABLE' : 'NOT AVAILABLE / CHECKING'} · Task: {status?.registered ? 'REGISTERED' : 'NOT REGISTERED'}</Text>
    <Text style={styles.info}>Background upload opt-in: {status?.enabled ? 'ENABLED' : 'OFF'}{status?.paused ? ' · PAUSED (MANUAL REVIEW REQUIRED)' : ''}</Text>
    <Text style={styles.info}>Provider: {status?.provider ?? 'none'} · Enabled at: {status?.enabledAt ?? 'Never'}</Text>
    <Text style={styles.info}>Last worker report: {last?.at ?? 'None'}</Text>
    {last && <>
      <Text style={styles.info}>Result: {last.outcome.toUpperCase()}</Text>
      <Text style={styles.info}>Created: {last.created} · Updated: {last.updated} · Unsafe / unmatched runs skipped: {last.unsafeSkipped}</Text>
    </>}
    {status?.enabled
      ? <Action label={busy ? 'Working…' : 'Stop background uploads'} onPress={() => { void action('disable'); }} busy={busy} secondary />
      : <Action label={busy ? 'Working…' : 'Enable background uploads for NEW runs (separate opt-in)'}
          onPress={() => { void action('enable'); }} disabled={!authorized || !status?.available || busy} busy={busy} secondary />}
    {__DEV__ && status?.enabled && !status.paused && status.registered &&
      <Action label="Trigger background sync worker (developer)" onPress={() => { void action('trigger'); }} busy={busy} secondary />}
    {Platform.OS === 'android' && status?.enabled && !status.paused && matches &&
      <Action label="Inspect recent Health Connect matching (read-only)" onPress={() => { void action('inspect'); }} busy={busy} secondary />}
    {inspection && <View style={styles.panel}>
      <Text style={styles.title}>Local Android matching inspection — no uploads</Text>
      <Text style={styles.info}>Checked: {inspection.inspectedAtUtc}</Text>
      <Text style={styles.info}>Enabled at UTC: {inspection.enabledAtUtc}</Text>
      <Text style={styles.info}>Exercise sessions found: {inspection.totalSessions} · Running: {inspection.runningSessions}</Text>
      {inspection.recentRuns.length === 0 && <Text style={styles.info}>No running sessions found in the last 24 hours.</Text>}
      {inspection.recentRuns.map((run, index) => <View key={index}>
        <Text style={styles.info}>Run #{index + 1}: {run.reason}</Text>
        <Text style={styles.copy}>Start UTC: {run.startUtc} · End UTC: {run.endUtc} · Duration: {run.durationSeconds}s</Text>
        <Text style={styles.copy}>Distance records returned: {run.recordsFound}; same writer: {run.sameWriterRecords}; both boundary minutes: {run.sameMinutePairRecords}</Text>
      </View>)}
      {inspection.truncated && <Text style={styles.copy}>Showing the newest five running sessions.</Text>}
    </View>}
    <Action label="Refresh background sync pilot status" onPress={() => { void action('refresh'); }} busy={busy} secondary />
    {status?.paused && <Text style={styles.error}>Background uploads have been paused after a permission, account, storage, or upload error. Verify your FitPro account and existing imports. Stop the pilot and explicitly opt in again to resume new-only imports.</Text>}
    {!authorized && <Text style={styles.copy}>Sign-in, consent, verified invite access and a platform-matching health provider are required to enable.</Text>}
    {!!message && <Text style={styles.success} selectable>{message}</Text>}
    {!!error && <Text style={styles.error} selectable>{error}</Text>}
    <Text style={styles.warning}>CONTROLLED PILOT LIMITATIONS: Android matches one same-writer distance record when BOTH start times fall in the same clock minute and BOTH end times fall in the same clock minute; seconds may differ. Ambiguous, overlapping, short partial, cross-writer and multi-record distances are still skipped. This is a testing compromise, not fully validated production attribution. The OS does not guarantee background execution. A forced developer run does not prove unattended reliability. Use manual import for unsupported runs.</Text>
  </View>;
}
const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderColor: colors.panelBorder, borderRadius: 14, backgroundColor: colors.panel,
    padding: 16, marginTop: 12, marginBottom: 20, gap: 9 },
  kicker: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  title: { color: colors.text, fontSize: 17, fontWeight: '800' },
  copy: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  info: { color: colors.text, fontSize: 12, lineHeight: 18 },
  success: { color: colors.accent, fontSize: 12, lineHeight: 18 },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18 },
  warning: { color: colors.subtle, fontSize: 10, lineHeight: 17, marginTop: 8 },
});
