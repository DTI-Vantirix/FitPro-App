/** React side of the run experience: who is signed in, their zones, and the live run. */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useSession } from '../auth/session';
import { useAccessGate } from '../access/access-gate';
import { ApiError, fetchMe, listZones, loadProfile } from './api';
import type { RunState } from './engine';
import { deviceCache } from './device/run-files';
import { flushRuns, getWaiting, heartRateMonitor, refreshWaiting, runController, setRunAuth, subscribeWaiting } from './runtime';
import { needsSetup, type Profile, type Zone } from './zones';

const OWNER_KEY = 'fitpro.native.6af5fd196ba44438a305cc72.run_owner.v1';
/** While runs are waiting and the app is open, try again this often. */
const RETRY_EVERY_MS = 60000;

type Account = {
  /** 'loading' until the account is known; 'offline' when it cannot be checked and was never cached. */
  status: 'blocked' | 'loading' | 'ready' | 'offline';
  ownerId: string | null;
  profile: Profile | null;
  zones: Zone[];
  /** True, false, or null when the server could not be asked. */
  setupNeeded: boolean | null;
  error: string | null;
  /** The invite check could not be reached, but this sign-in passed it before on this phone. */
  offlineAccess: boolean;
  reload: () => Promise<void>;
};

const AccountContext = createContext<Account | null>(null);

async function cachedOwner(token: string): Promise<string | null> {
  try {
    const raw = await SecureStore.getItemAsync(OWNER_KEY);
    const saved = raw ? (JSON.parse(raw) as { tail?: string; id?: string }) : null;
    return saved && saved.tail === token.slice(-24) && typeof saved.id === 'string' ? saved.id : null;
  } catch {
    return null;
  }
}

/** Loads the account behind the current sign-in once consent and invite have passed,
 * and keeps the upload queue moving while the app is open. */
export function RunAccountProvider({ children }: { children: React.ReactNode }) {
  const { accessToken, forgetSession } = useSession();
  const { status: gate } = useAccessGate();
  // With no signal the invite check cannot be made. A sign-in that already passed it on this
  // phone (its owner id is only ever cached after a pass) may still record a run: the server
  // checks the invite again on every upload. Health import keeps its own strict gate.
  const [knownToken, setKnownToken] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!accessToken || gate !== 'error') { setKnownToken(null); return; }
    void cachedOwner(accessToken).then((id) => { if (live) setKnownToken(id ? accessToken : null); });
    return () => { live = false; };
  }, [accessToken, gate]);
  const offlineAccess = Boolean(accessToken) && gate === 'error' && knownToken === accessToken;
  const allowed = Boolean(accessToken) && (gate === 'allowed' || offlineAccess);
  const sequence = useRef(0);
  const [state, setState] = useState<Omit<Account, 'reload' | 'offlineAccess'>>({ status: 'blocked', ownerId: null, profile: null, zones: [], setupNeeded: null, error: null });

  const reload = useCallback(async () => {
    if (!accessToken || !allowed) return;
    const token = accessToken;
    // A reload still in flight when the runner signs out (or another reload starts) changes nothing.
    const turn = ++sequence.current;
    const stale = () => sequence.current !== turn;
    let ownerId = await cachedOwner(token);
    try {
      const me = await fetchMe(token);
      ownerId = me.id;
      await SecureStore.setItemAsync(OWNER_KEY, JSON.stringify({ tail: token.slice(-24), id: me.id })).catch(() => {});
    } catch (cause) {
      if (stale()) return;
      if (cause instanceof ApiError && cause.status === 401) {
        // The contract: any 401 means the sign-in is no longer valid.
        setRunAuth(null);
        await forgetSession().catch(() => {});
        return;
      }
      if (!ownerId) {
        setState({ status: 'offline', ownerId: null, profile: null, zones: [], setupNeeded: null, error: cause instanceof Error ? cause.message : String(cause) });
        return;
      }
    }
    if (stale()) return;
    setRunAuth({ token, ownerId });
    void refreshWaiting();
    try {
      const [profile, zones] = await Promise.all([loadProfile(token, ownerId), listZones(token, ownerId)]);
      if (stale()) return;
      setState({ status: 'ready', ownerId, profile, zones, setupNeeded: needsSetup(profile, zones), error: null });
      void deviceCache.write(`account-${ownerId}`, { profile, zones });
    } catch (cause) {
      // No connection: what was loaded last time is enough to start a run.
      const cached = await deviceCache.read<{ profile: Profile | null; zones: Zone[] }>(`account-${ownerId}`);
      const usable = cached && Array.isArray(cached.zones) && !needsSetup(cached.profile, cached.zones) ? cached : null;
      if (stale()) return;
      setState({
        status: 'ready', ownerId,
        profile: usable?.profile ?? null,
        zones: usable?.zones ?? [],
        setupNeeded: usable ? false : null,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
    void flushRuns();
  }, [accessToken, allowed, forgetSession]);

  useEffect(() => {
    if (!allowed) {
      sequence.current += 1;
      setRunAuth(null);
      setState({ status: 'blocked', ownerId: null, profile: null, zones: [], setupNeeded: null, error: null });
      return;
    }
    setState((previous) => ({ ...previous, status: 'loading' }));
    void reload();
  }, [allowed, reload]);

  useEffect(() => {
    if (!allowed) return;
    const subscription = AppState.addEventListener('change', (next) => { if (next === 'active') void flushRuns(); });
    const timer = setInterval(() => { if (getWaiting().pending > 0) void flushRuns(); }, RETRY_EVERY_MS);
    return () => { subscription.remove(); clearInterval(timer); };
  }, [allowed]);

  const value = useMemo(() => ({ ...state, offlineAccess, reload }), [state, offlineAccess, reload]);
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useRunAccount(): Account {
  const value = useContext(AccountContext);
  if (!value) throw new Error('useRunAccount requires RunAccountProvider');
  return value;
}

export function useRun(): RunState | null {
  return useSyncExternalStore(runController.subscribe, runController.getState, runController.getState);
}

export function useWaitingRuns(): { pending: number; needsAttention: number } {
  return useSyncExternalStore(subscribeWaiting, getWaiting, getWaiting);
}

export function useHeartRateSensor(): { status: ReturnType<typeof heartRateMonitor.status>; name: string | null } {
  const status = useSyncExternalStore(heartRateMonitor.subscribe, heartRateMonitor.status, heartRateMonitor.status);
  return { status, name: heartRateMonitor.deviceName() };
}
