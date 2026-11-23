/** Step 7B.2B — explicit read-only health background diagnostic controls. */
import React, { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Action } from '../components/Ui';
import { colors } from '../theme';
import {
  enableHealthReadDiagnostic, disableHealthReadDiagnostic,
  triggerHealthReadDiagnosticForTesting, healthReadDiagnosticStatus,
  type HealthReadDiagnosticStatus,
} from './background-health-read-diagnostic';

type Props = Readonly<{
  provider: 'apple' | 'health_connect' | 'fake';
  signedIn: boolean;
  consentAccepted: boolean;
  inviteVerified: boolean;
}>;

export function BackgroundHealthReadDiagnosticPanel({ provider, signedIn, consentAccepted, inviteVerified }: Props) {
  const [current, setCurrent] = useState<HealthReadDiagnosticStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const allowed = signedIn && consentAccepted && inviteVerified &&
    ((Platform.OS === 'ios' && provider === 'apple') ||
      (Platform.OS === 'android' && provider === 'health_connect'));
  const refresh = useCallback(async () => { setCurrent(await healthReadDiagnosticStatus()); }, []);
  useEffect(() => {
    let mounted = true;
    healthReadDiagnosticStatus().then((s) => { if (mounted) setCurrent(s); })
      .catch((e: unknown) => { if (mounted) setError(e instanceof Error ? e.message : String(e)); });
    return () => { mounted = false; };
  }, []);
  async function perform(action: 'start' | 'stop' | 'trigger' | 'refresh') {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      if (action === 'start') {
        if (!allowed || !["apple", "health_connect"].includes(provider)) throw new Error('Sign in, verify invite, accept consent, and select your OS health provider.');
        await enableHealthReadDiagnostic(provider);
        setNotice('Opt-in recorded; the native worker can read limited local health record counts. No workout is uploaded.');
      } else if (action === 'stop') {
        await disableHealthReadDiagnostic();
        setNotice('Background read diagnostic disabled and unregistered.');
      } else if (action === 'trigger') {
        await triggerHealthReadDiagnosticForTesting();
        setNotice('Development worker trigger sent. Refresh to inspect the execution report.');
      }
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const last = current?.last;
  return <View style={styles.panel}>
    <Text style={styles.kicker}>STEP 7B.2B · BACKGROUND HEALTH READ TEST</Text>
    <Text style={styles.title}>Background health authorization</Text>
    <Text style={styles.copy}>Separate opt-in for a device-only diagnostic. Android requests Health Connect background read access; iOS requests HealthKit workout read access and configures a native workout observer. A scheduled worker reads up to 20 recent sessions (and Android distance records). Only counts and a status are saved on this device.</Text>
    <Text style={styles.info}>Scheduler: {current?.available ? 'AVAILABLE' : 'NOT AVAILABLE / CHECKING'} · Task: {current?.registered ? 'REGISTERED' : 'NOT REGISTERED'}</Text>
    <Text style={styles.info}>Diagnostic: {current?.enabled ? 'ENABLED' : 'OFF'} · Provider: {current?.provider ?? 'none'}</Text>
    <Text style={styles.info}>Last health read: {last?.at ?? 'None'}</Text>
    {last && <>
      <Text style={styles.info}>Result: {last.outcome.toUpperCase()}</Text>
      {last.outcome === 'read_ok' && <Text style={styles.info}>Recent running workouts / sessions: {last.sessionCount ?? 0}{last.distanceRecordCount != null ? ` · Distance records: ${last.distanceRecordCount}` : ''}{last.truncated ? ' · First 20 records only' : ''}</Text>}
    </>}
    {current?.enabled
      ? <Action label={busy ? 'Working…' : 'Stop background health read diagnostic'} onPress={() => { void perform('stop'); }} busy={busy} secondary />
      : <Action label={busy ? 'Working…' : 'Enable background health read test (no uploads)'} onPress={() => { void perform('start'); }} busy={busy} disabled={!allowed || !current?.available} secondary />}
    {__DEV__ && current?.enabled && current.registered &&
      <Action label="Trigger background health read now (developer)" onPress={() => { void perform('trigger'); }} busy={busy} secondary />}
    <Action label="Refresh background health read status" onPress={() => { void perform('refresh'); }} busy={busy} secondary />
    {!allowed && <Text style={styles.copy}>Sign in, authorize access, accept consent and select the platform-matching provider before starting.</Text>}
    {!!notice && <Text style={styles.success}>{notice}</Text>}
    {!!error && <Text style={styles.error} selectable>{error}</Text>}
    <Text style={styles.warning}>NO BACKGROUND UPLOADS. Apple Health does not disclose which read categories were granted; a query returning zero samples does not prove permission denial. OS scheduling is deferred and is not guaranteed. Android's temporary same-minute distance matcher is NOT used by this diagnostic.</Text>
  </View>;
}
const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderColor: colors.panelBorder, borderRadius: 14, backgroundColor: colors.panel,
    padding: 16, marginTop: 12, marginBottom: 20, gap: 9 },
  kicker: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: colors.text, fontSize: 17, fontWeight: '800' },
  copy: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  info: { color: colors.text, fontSize: 12, lineHeight: 18 },
  success: { color: colors.accent, fontSize: 12, lineHeight: 18 },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18 },
  warning: { color: colors.subtle, fontSize: 10, lineHeight: 17, marginTop: 8 },
});
