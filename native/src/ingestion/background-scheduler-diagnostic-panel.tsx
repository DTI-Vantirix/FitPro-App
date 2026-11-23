/** Step 7B.2a: explicit OS scheduler test only. NO background health reads/uploads. */
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Action } from '../components/Ui';
import { colors } from '../theme';
import {
  backgroundSchedulerDiagnosticStatus, enableBackgroundSchedulerDiagnostic,
  disableBackgroundSchedulerDiagnostic, triggerBackgroundSchedulerDiagnosticForTesting,
  type BackgroundSchedulerDiagnosticStatus,
} from './background-scheduler-diagnostic';

type Props = Readonly<{
  provider: 'fake' | 'apple' | 'health_connect';
  signedIn: boolean;
  consentAccepted: boolean;
  inviteVerified: boolean;
}>;

export function BackgroundSchedulerDiagnosticPanel({ provider, signedIn, consentAccepted, inviteVerified }: Props) {
  const [current, setCurrent] = useState<BackgroundSchedulerDiagnosticStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const allowed = signedIn && consentAccepted && inviteVerified && provider !== 'fake';
  const refresh = useCallback(async () => {
    const next = await backgroundSchedulerDiagnosticStatus();
    setCurrent(next);
  }, []);
  useEffect(() => {
    let mounted = true;
    backgroundSchedulerDiagnosticStatus().then((next) => { if (mounted) setCurrent(next); })
      .catch((cause) => { if (mounted) setError(String(cause)); });
    return () => { mounted = false; };
  }, []);
  async function perform(action: 'enable' | 'disable' | 'trigger' | 'refresh') {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (action === 'enable') {
        if (!allowed) throw new Error('Sign in, consent, and invite authorization are required.');
        await enableBackgroundSchedulerDiagnostic();
        setNotice('OS scheduler diagnostic registered. NO health data will be read or uploaded.');
      } else if (action === 'disable') {
        await disableBackgroundSchedulerDiagnostic();
        setNotice('Diagnostic task unregistered.');
      } else if (action === 'trigger') {
        const triggered = await triggerBackgroundSchedulerDiagnosticForTesting();
        setNotice(`Development trigger returned ${String(triggered)}. Refresh to inspect last execution.`);
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  return <View style={styles.panel}>
    <Text style={styles.kicker}>STEP 7B.2A · NATIVE SCHEDULER CHECK</Text>
    <Text style={styles.title}>Background scheduler smoke test</Text>
    <Text style={styles.copy}>This checks whether the OS can wake a FitPro task. It never reads HealthKit or Health Connect, never accesses workout data, and never calls the FitPro API.</Text>
    <Text style={styles.info}>Scheduler available: {current === null ? 'Checking…' : current.available ? 'YES' : 'NO'}</Text>
    <Text style={styles.info}>Diagnostic registered: {current?.registered ? 'YES' : 'NO'} · Enabled: {current?.enabled ? 'YES' : 'NO'}</Text>
    <Text style={styles.info}>Last observed execution: {current?.lastRun ?? 'None'}</Text>
    {!allowed && <Text style={styles.copy}>Select a real health provider and complete sign-in, consent, and invite verification before scheduling the diagnostic.</Text>}
    {current?.enabled
      ? <Action label={busy ? 'Working…' : 'Stop scheduler diagnostic'} onPress={() => { void perform('disable'); }} busy={busy} secondary />
      : <Action label={busy ? 'Working…' : 'Start scheduler diagnostic (NO health uploads)'} onPress={() => { void perform('enable'); }} disabled={!allowed || !current?.available} busy={busy} secondary />}
    {__DEV__ && current?.registered && current.enabled && <Action label="Trigger diagnostic now (development only)" onPress={() => { void perform('trigger'); }} busy={busy} secondary />}
    <Action label="Refresh scheduler status" onPress={() => { void perform('refresh'); }} busy={busy} secondary />
    {!!notice && <Text style={styles.success}>{notice}</Text>}
    {!!error && <Text style={styles.error} selectable>{error}</Text>}
    <Text style={styles.warning}>BACKGROUND HEALTH SYNCHRONIZATION IS OFF. This diagnostic opt-in does not authorize unattended import. Disable it after the scheduler test.</Text>
  </View>;
}
const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderColor: colors.panelBorder, borderRadius: 14, backgroundColor: colors.panel,
    padding: 16, marginTop: 12, marginBottom: 20, gap: 8 },
  kicker: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: colors.text, fontSize: 17, fontWeight: '800' },
  copy: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  info: { color: colors.text, fontSize: 12, lineHeight: 18 },
  success: { color: colors.accent, fontSize: 12, lineHeight: 18 },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18 },
  warning: { color: colors.subtle, fontSize: 10, lineHeight: 17, marginTop: 8 },
});
