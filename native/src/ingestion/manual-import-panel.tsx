import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useSession } from '../auth/session';
import { Action } from '../components/Ui';
import type { NormalizedActivity } from '../health/types';
import { colors } from '../theme';
import { activitySyncKey, ActivitySyncError, buildActivityPayload, submitHealthActivity } from './activity-sync';
import { appendImportReceipt, loadImportHistory, type ImportOutcome, type ImportReceipt } from './import-history';
import { loadAutoSyncState, markActivitySynced, setAutoSyncEnabled, type AutoSyncState } from './auto-sync-state';
import { eligibleAutoActivities } from './auto-sync-selection';
import { AUTO_HEALTH_IMPORT_ENABLED } from './auto-import-policy';

type AdapterId = 'fake' | 'apple' | 'health_connect';
type Props = Readonly<{
  activities: ReadonlyArray<NormalizedActivity>;
  adapterId: AdapterId;
  authorized: boolean;
  readWarnings?: ReadonlyArray<string>;
  onForegroundResume?: () => void;
}>;
type BatchCounts = Record<ImportOutcome, number>;

function displayDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString();
}

function receiptFor(item: NormalizedActivity, outcome: ImportOutcome, httpStatus?: number): ImportReceipt {
  return {
    activityKey: activitySyncKey(item),
    source: item.source as 'apple' | 'health_connect',
    kind: item.kind,
    outcome,
    completedAt: new Date().toISOString(),
    ...(httpStatus === undefined ? {} : { httpStatus }),
  };
}

/** Manual import remains available. Step 7A adds optional foreground auto-import
 * only after explicit opt-in and only when the existing health read gate has passed.
 * No OS permissions are requested here; no background uploads or timers.
 */
export function ManualImportPanel({ activities, adapterId, authorized, readWarnings = [], onForegroundResume }: Props) {
  const { accessToken, consentAccepted, consentGeneration } = useSession();
  const [selected, setSelected] = useState<string[]>([]);
  const [history, setHistory] = useState<ImportReceipt[]>([]);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [counts, setCounts] = useState<BatchCounts | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [autoPrefs, setAutoPrefs] = useState<AutoSyncState | null>(null);
  const [historyReady, setHistoryReady] = useState(false);
  const [autoStatus, setAutoStatus] = useState('');
  const [autoSaving, setAutoSaving] = useState(false);
  const focused = useIsFocused();
  const appState = useRef(AppState.currentState);
  const checkedRead = useRef<ReadonlyArray<NormalizedActivity> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const busyGuard = useRef(false);
  const live = useRef(true);
  const realProvider = adapterId === 'apple' || adapterId === 'health_connect';
  const active = Boolean(authorized && accessToken && consentAccepted && realProvider);

  // An account/consent/provider switch aborts the current batch and clears selection.
  useEffect(() => {
    live.current = true;
    setSelected([]);
    setResults({});
    setCounts(null);
    setStorageError(null);
    setHistory([]);
    setHistoryReady(false);
    setAutoPrefs(null);
    setAutoStatus('');
    checkedRead.current = null;
    let mounted = true;
    if (active) {
      Promise.all([loadImportHistory(), loadAutoSyncState()])
        .then(([records, prefs]) => {
          if (!mounted) return;
          setHistory(records);
          setAutoPrefs(prefs);
          setHistoryReady(true);
        })
        .catch((cause: unknown) => { if (mounted) setStorageError(`Automatic import paused: ${String(cause)}`); });
    }
    return () => {
      mounted = false;
      live.current = false;
      controller.current?.abort();
    };
  }, [active, adapterId, accessToken, consentGeneration]);

  const available = useMemo(() => activities.filter((item) =>
    item.source === adapterId && (item.kind === 'run' || item.kind === 'workout')),
    [activities, adapterId]);
  const alreadySucceeded = useMemo(() => new Set(history.filter((x) => x.outcome === 'created' || x.outcome === 'updated')
    .map((x) => x.activityKey)), [history]);
  const selectedActivities = useMemo(() => available.filter((item) => selected.includes(activitySyncKey(item))), [available, selected]);

  useEffect(() => {
    const allowed = new Set(available.map(activitySyncKey));
    setSelected((prior) => prior.filter((key) => allowed.has(key)));
  }, [available]);

  // On return from background, refresh the health read only if we are already
  // on Activities with an authorized real adapter. Never prompt for permissions.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const previous = appState.current;
      appState.current = next;
      if (next !== 'active') controller.current?.abort();
      if (AUTO_HEALTH_IMPORT_ENABLED && previous !== 'active' && next === 'active' && focused && active && autoPrefs?.enabled) {
        onForegroundResume?.();
      }
    });
    return () => sub.remove();
  }, [focused, active, autoPrefs?.enabled, onForegroundResume]);

  async function toggleAuto() {
    if (!AUTO_HEALTH_IMPORT_ENABLED || !active || !historyReady || autoSaving || storageError) return;
    const enabled = !autoPrefs?.enabled;
    if (!enabled) controller.current?.abort();
    setAutoSaving(true);
    try {
      const next = await setAutoSyncEnabled(enabled);
      if (!live.current) return;
      setAutoPrefs(next);
      checkedRead.current = null;
      setAutoStatus(enabled
        ? 'Enabled. Only workouts completed after this moment are eligible; earlier activities stay manual.'
        : 'Automatic import disabled. Previously imported server records are retained.');
    } catch (cause) {
      if (live.current) setStorageError(`Could not change automatic import: ${String(cause)}`);
    } finally { if (live.current) setAutoSaving(false); }
  }

  // One pass for each newly completed adapter read; never poll, run in background,
  // or queue stale activities. Manual and auto paths share the same in-flight guard.
  useEffect(() => {
    if (!AUTO_HEALTH_IMPORT_ENABLED || !active || !focused || !historyReady || !autoPrefs?.enabled || storageError || busyGuard.current) return;
    if (checkedRead.current === activities) return;
    checkedRead.current = activities;
    if (adapterId === 'health_connect' && readWarnings.some((w) => w.includes('distance matched by exact workout interval from a different app'))) {
      setAutoStatus('Auto-import paused for this Health Connect read: cross-app distance matching needs manual review.');
      return;
    }
    let mounted = true;
    let autoController: AbortController | null = null;
    const run = async () => {
      if (!accessToken || AppState.currentState !== 'active' || busyGuard.current) return;
      const due = eligibleAutoActivities(activities, adapterId, autoPrefs, history);
      if (!due.length) { if (mounted && live.current) setAutoStatus('Auto-import is up to date for this read.'); return; }
      const running = new AbortController();
      autoController = running;
      controller.current = running;
      busyGuard.current = true;
      setBusy(true);
      const totals: BatchCounts = { created: 0, updated: 0, skipped: 0, failed: 0 };
      let prefs = autoPrefs;
      try {
        for (let i = 0; i < due.length; i++) {
          if (!mounted || !live.current || running.signal.aborted) break;
          // Read opt-in from storage again so an interrupted opt-out fails closed.
          const persisted = await loadAutoSyncState();
          if (!persisted.enabled || persisted.enabledAt !== autoPrefs.enabledAt) break;
          const item = due[i];
          const key = activitySyncKey(item);
          setProgress(`Auto-import ${i + 1} of ${due.length} · ${item.kind}`);
          try {
            const result = await submitHealthActivity(item, accessToken, running.signal);
            if (running.signal.aborted || !mounted || !live.current) break;
            prefs = await markActivitySynced(prefs, key);
            const records = await appendImportReceipt(receiptFor(item, result.action));
            if (mounted && live.current) { setAutoPrefs(prefs); setHistory(records); }
            totals[result.action] += 1;
          } catch (cause) {
            if (running.signal.aborted || !mounted || !live.current) break;
            totals.failed++;
            setAutoStatus(`Auto-import stopped: ${cause instanceof Error ? cause.message : String(cause)}. Use manual import to retry.`);
            break;
          }
        }
        if (mounted && live.current) {
          setCounts({ ...totals });
          if (!totals.failed) setAutoStatus(`Auto-import finished: ${totals.created} created, ${totals.updated} updated.`);
        }
      } catch (cause) {
        if (mounted && live.current && !running.signal.aborted) setAutoStatus(`Auto-import paused: ${String(cause)}`);
      } finally {
        if (live.current) { setBusy(false); setProgress(''); }
        if (controller.current === running) controller.current = null;
        busyGuard.current = false;
      }
    };
    void run();
    return () => { mounted = false; autoController?.abort(); };
  }, [activities, active, adapterId, focused, historyReady, autoPrefs?.enabled, storageError]);

  function toggle(item: NormalizedActivity) {
    if (!active || busyGuard.current) return;
    const key = activitySyncKey(item);
    setSelected((before) => before.includes(key) ? before.filter((x) => x !== key) : [...before, key]);
  }

  async function importSelected(reimport: boolean) {
    if (!active || !accessToken || busyGuard.current || !selectedActivities.length || storageError) return;
    busyGuard.current = true;
    setBusy(true);
    setResults({});
    const nextCounts: BatchCounts = { created: 0, updated: 0, skipped: 0, failed: 0 };
    const currentResults: Record<string, string> = {};
    const running = new AbortController();
    controller.current = running;
    try {
      for (let i = 0; i < selectedActivities.length; i++) {
        if (running.signal.aborted || !live.current) break;
        const item = selectedActivities[i];
        const key = activitySyncKey(item);
        setProgress(`${i + 1} of ${selectedActivities.length} · ${item.kind} · ${item.source}`);
        let outcome: ImportOutcome;
        let text: string;
        let status: number | undefined;
        if (!reimport && alreadySucceeded.has(key)) {
          outcome = 'skipped';
          text = 'Skipped: previously imported on this device. Use Re-import selected to update.';
        } else {
          try {
            // Validate before fetch. This never constructs fabricated exercise data.
            buildActivityPayload(item);
            const response = await submitHealthActivity(item, accessToken, running.signal);
            outcome = response.action;
            text = response.action === 'created'
              ? 'Imported successfully (created in VantraRun).'
              : response.action === 'skipped'
                ? 'Already in VantraRun: this is the same run VantraRun recorded, so nothing was added.'
                : 'Imported successfully (updated existing VantraRun record).';
          } catch (cause: unknown) {
            if (running.signal.aborted) break;
            outcome = 'failed';
            status = cause instanceof ActivitySyncError ? cause.httpStatus ?? undefined : undefined;
            text = cause instanceof Error ? cause.message : String(cause);
          }
        }
        if (running.signal.aborted || !live.current) break;
        nextCounts[outcome]++;
        currentResults[key] = text;
        setResults({ ...currentResults });
        setCounts({ ...nextCounts });
        try {
          const records = await appendImportReceipt(receiptFor(item, outcome, status));
          if (live.current) setHistory(records);
        } catch (cause: unknown) {
          // A successful remote upload is NOT reported as failed due to local receipt failure.
          if (live.current) setStorageError(`Import receipt storage failed: ${String(cause)}. Check results above before retrying.`);
          break;
        }
      }
    } finally {
      if (live.current) {
        setBusy(false);
        setProgress('');
        setSelected([]);
      }
      controller.current = null;
      busyGuard.current = false;
    }
  }

  if (!realProvider) {
    return <View style={styles.panel}>
      <Text style={styles.title}>Step 6 · Manual imports</Text>
      <Text style={styles.description}>Sample activities are never uploaded. Switch to Apple Health or Health Connect and read real device records first.</Text>
    </View>;
  }
  return <View style={styles.panel}>
    {!AUTO_HEALTH_IMPORT_ENABLED && <Text style={styles.description}>Automatic import is switched off, so a run recorded in FitPro and on your watch is not saved twice. Import a run by hand below.</Text>}
    {AUTO_HEALTH_IMPORT_ENABLED && <>
    <Text style={styles.kicker}>STEP 07A · FOREGROUND AUTO SYNC (OPT-IN)</Text>
    <Text style={styles.title}>Automatically import new workouts</Text>
    <Text style={styles.description}>Off by default. Once enabled, newly completed workouts can be uploaded after an authorized Activities read or when you return to this screen. An upload may include distance, duration, heart rate, and GPS route if provided. Nothing runs while VantraRun is closed.</Text>
    {autoPrefs !== null && <Action
      label={autoPrefs.enabled ? 'Disable foreground auto-import' : 'Enable foreground auto-import'}
      secondary busy={autoSaving} disabled={!active || !!storageError || autoSaving}
      onPress={() => { void toggleAuto(); }} />}
    {autoPrefs !== null && <Text style={styles.small}>Setting: {autoPrefs.enabled ? 'ON' : 'OFF'} · Existing workouts remain manual · Maximum 5 new imports per read</Text>}
    {!!autoStatus && <Text accessibilityLiveRegion="polite" selectable style={styles.result}>{autoStatus}</Text>}
    </>}
    <Text style={styles.kicker}>STEP 06 · MANUAL IMPORT (ALWAYS AVAILABLE)</Text>
    <Text style={styles.title}>Import selected activities</Text>
    <Text style={styles.description}>Manual imports always remain available. The existing ingestActivity endpoint receives selected records; fake records are never eligible.</Text>
    {!active ? <Text style={styles.error}>Import is disabled until consent, sign-in, and VantraRun invite authorization are confirmed.</Text> : <>
      <Text style={styles.count}>{selectedActivities.length} selected of {available.length} readable activities</Text>
      {available.length === 0 && <Text style={styles.description}>No importable activities loaded. Refresh your health adapter above.</Text>}
      {available.map((item) => {
        const key = activitySyncKey(item);
        const checked = selected.includes(key);
        return <Pressable key={key} accessibilityRole="checkbox" accessibilityState={{ checked, disabled: busy }}
          disabled={busy} onPress={() => toggle(item)}
          style={({ pressed }) => [styles.choice, checked && styles.choiceSelected, pressed && styles.pressed]}>
          <Text style={styles.check}>{checked ? '☑' : '□'}</Text>
          <View style={styles.choiceText}>
            <Text style={styles.name}>{item.kind === 'run' ? item.routeName : item.name}</Text>
            <Text style={styles.small}>{displayDate(item.kind === 'run' ? item.startedAt : item.performedAt)}{alreadySucceeded.has(key) ? ' · Previously imported' : ''}</Text>
            {results[key] && <Text selectable style={styles.result}>{results[key]}</Text>}
          </View>
        </Pressable>;
      })}
      {!!selectedActivities.length && <>
        <Action label={busy ? 'Importing…' : `Import ${selectedActivities.length} selected`}
          busy={busy} disabled={!active || !!storageError} onPress={() => { void importSelected(false); }} />
        <Action label="Re-import selected (update existing records)" secondary busy={busy}
          disabled={!active || !!storageError} onPress={() => { void importSelected(true); }} />
      </>}
      {busy && <View style={styles.progress}><ActivityIndicator color={colors.accent} /><Text style={styles.description}>{progress}</Text></View>}
      {counts && <Text accessibilityLiveRegion="polite" style={styles.summary}>
        Batch: {counts.created} created · {counts.updated} updated · {counts.skipped} skipped · {counts.failed} failed
      </Text>}
      {storageError && <Text selectable style={styles.error}>{storageError}</Text>}
      <Text style={styles.historyTitle}>Recent import history (this device)</Text>
      {history.length === 0 ? <Text style={styles.small}>No import attempts recorded yet.</Text> : history.slice(0, 12).map((record, idx) =>
        <Text key={`${record.activityKey}:${record.completedAt}:${idx}`} style={styles.history} selectable>
          {record.outcome.toUpperCase()} · {record.source} · {record.kind} · {displayDate(record.completedAt)}
          {record.httpStatus !== undefined ? ` · HTTP ${record.httpStatus}` : ''}
          {'\n'}ID: {record.activityKey.slice(0, 84)}
        </Text>)}
      <Text style={styles.footnote}>Local receipts clear on sign-out or consent withdrawal. Existing VantraRun records are not deleted. Nothing is imported automatically.</Text>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderColor: colors.panelBorder, borderRadius: 14, backgroundColor: colors.panel,
    padding: 16, marginTop: 16, marginBottom: 20, gap: 8 },
  kicker: { color: colors.accent, letterSpacing: 1.5, fontWeight: '800', fontSize: 11 },
  title: { color: colors.text, fontWeight: '800', fontSize: 18 },
  description: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  count: { color: colors.text, fontSize: 13, fontWeight: '700', marginTop: 6 },
  choice: { borderWidth: 1, borderColor: colors.panelBorder, borderRadius: 10, padding: 12, flexDirection: 'row', gap: 12 },
  choiceSelected: { borderColor: colors.accent, backgroundColor: '#19352F' },
  pressed: { opacity: 0.6 },
  choiceText: { flex: 1, gap: 5 },
  check: { color: colors.accent, fontSize: 25, marginTop: 1 },
  name: { color: colors.text, fontWeight: '700', fontSize: 14 },
  small: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  result: { color: colors.accent, fontSize: 12, lineHeight: 19 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  summary: { color: colors.accent, fontWeight: '700', fontSize: 13, marginTop: 12, lineHeight: 22 },
  error: { color: colors.danger, fontSize: 12, lineHeight: 19 },
  historyTitle: { color: colors.text, fontWeight: '800', fontSize: 14, marginTop: 16 },
  history: { color: colors.muted, fontSize: 11, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.panelBorder, lineHeight: 18 },
  footnote: { color: colors.subtle, fontSize: 11, lineHeight: 17, marginTop: 8 },
});
