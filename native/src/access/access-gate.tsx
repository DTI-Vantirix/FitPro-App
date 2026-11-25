import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../auth/session';
import { getInviteStatus, redeemInviteCode } from './invite-api';

export type GateStatus = 'blocked' | 'checking' | 'allowed' | 'needs_invite' | 'error';
type GateRecord = { key: string; status: GateStatus; error: string | null };
type GateContextValue = {
  status: GateStatus;
  error: string | null;
  refresh: () => Promise<void>;
  redeem: (code: string) => Promise<void>;
};

const GateContext = createContext<GateContextValue | null>(null);

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function AccessGateProvider({ children }: { children: React.ReactNode }) {
  const { accessToken, consentAccepted, consentGeneration } = useSession();
  const key = `${consentGeneration}:${accessToken ?? ''}`;
  const currentKeyRef = useRef(key);
  currentKeyRef.current = key;
  const requestSequence = useRef(0);
  const [gate, setGate] = useState<GateRecord>({ key: '', status: 'blocked', error: null });

  const refresh = useCallback(async () => {
    if (!accessToken || !consentAccepted) return;
    const targetKey = `${consentGeneration}:${accessToken}`;
    const sequence = ++requestSequence.current;
    setGate({ key: targetKey, status: 'checking', error: null });
    try {
      const result = await getInviteStatus(accessToken);
      if (requestSequence.current === sequence && currentKeyRef.current === targetKey) {
        setGate({ key: targetKey, status: result.allowed ? 'allowed' : 'needs_invite', error: null });
      }
    } catch (error) {
      if (requestSequence.current === sequence && currentKeyRef.current === targetKey) {
        setGate({ key: targetKey, status: 'error', error: message(error) });
      }
    }
  }, [accessToken, consentAccepted, consentGeneration]);

  useEffect(() => {
    if (!accessToken || !consentAccepted) {
      ++requestSequence.current;
      setGate({ key: '', status: 'blocked', error: null });
    } else {
      void refresh();
    }
    return () => { ++requestSequence.current; };
  }, [accessToken, consentAccepted, consentGeneration, refresh]);

  const redeem = useCallback(async (code: string) => {
    if (!accessToken || !consentAccepted) throw new Error('Consent and sign-in are required.');
    const targetKey = `${consentGeneration}:${accessToken}`;
    const sequence = ++requestSequence.current;
    try {
      const result = await redeemInviteCode(accessToken, code);
      if (requestSequence.current !== sequence || currentKeyRef.current !== targetKey) {
        throw new Error('Session changed while verifying the invite. Sign in again.');
      }
      if (!result.allowed) {
        setGate({ key: targetKey, status: 'needs_invite', error: result.error || 'This invite code was not accepted.' });
        throw new Error(result.error || 'This invite code was not accepted.');
      }
      setGate({ key: targetKey, status: 'allowed', error: null });
    } catch (error) {
      // Errors are displayed by the invite screen; access never becomes granted on failure.
      throw error;
    }
  }, [accessToken, consentAccepted, consentGeneration]);

  const status: GateStatus = !accessToken || !consentAccepted ? 'blocked'
    : gate.key === key ? gate.status : 'checking';
  const error = gate.key === key ? gate.error : null;
  const value = useMemo(() => ({ status, error, refresh, redeem }), [status, error, refresh, redeem]);
  return <GateContext.Provider value={value}>{children}</GateContext.Provider>;
}

export function useAccessGate(): GateContextValue {
  const value = useContext(GateContext);
  if (!value) throw new Error('useAccessGate requires AccessGateProvider');
  return value;
}
