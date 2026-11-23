import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { clearImportHistory } from '../ingestion/import-history';
import { clearAutoSyncState } from '../ingestion/auto-sync-state';
import { clearBackgroundSchedulerDiagnostic } from '../ingestion/background-scheduler-diagnostic';
import { clearBackgroundHealthReadDiagnostic } from '../ingestion/background-health-read-diagnostic';
import { clearBackgroundSyncPilot } from '../ingestion/background-sync-pilot';

const TOKEN_KEY = 'fitpro.native.6af5fd196ba44438a305cc72.user.access_token';
// Explicit consent is local to the current signed-in session. A new login requires fresh consent.
const CONSENT_KEY = 'fitpro.native.6af5fd196ba44438a305cc72.health_import_consent.v1';
const CONSENT_VALUE = 'accepted:v1';

type SessionContextValue = {
  accessToken: string | null;
  consentAccepted: boolean;
  consentGeneration: number;
  loadingSession: boolean;
  sessionError: string | null;
  saveSession: (token: string) => Promise<void>;
  acceptConsent: () => Promise<void>;
  withdrawConsent: () => Promise<void>;
  forgetSession: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [consentGeneration, setConsentGeneration] = useState(0);
  const [loadingSession, setLoadingSession] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([SecureStore.getItemAsync(TOKEN_KEY), SecureStore.getItemAsync(CONSENT_KEY)])
      .then(([savedToken, savedConsent]) => {
        if (!mounted) return;
        setAccessToken(savedToken);
        setConsentAccepted(Boolean(savedToken && savedConsent === CONSENT_VALUE));
      })
      .catch((error: unknown) => {
        if (mounted) setSessionError(error instanceof Error ? error.message : String(error));
        // Fail closed if either secure storage read fails.
      })
      .finally(() => {
        if (mounted) setLoadingSession(false);
      });
    return () => { mounted = false; };
  }, []);

  const saveSession = useCallback(async (token: string) => {
    if (!token) throw new Error('Refusing to store an empty user token.');
    // Prevent consent accepted for a previous account from carrying into a new login.
    await SecureStore.deleteItemAsync(CONSENT_KEY);
    await clearBackgroundSyncPilot();
    setConsentAccepted(false);
    await clearImportHistory();
    await clearAutoSyncState();
    await clearBackgroundSchedulerDiagnostic();
    await clearBackgroundHealthReadDiagnostic();
    setConsentGeneration((previous) => previous + 1);
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    setSessionError(null);
    setAccessToken(token);
  }, []);

  const acceptConsent = useCallback(async () => {
    if (!accessToken) throw new Error('Sign in before accepting health import consent.');
    await SecureStore.setItemAsync(CONSENT_KEY, CONSENT_VALUE);
    setConsentAccepted(true);
    setConsentGeneration((previous) => previous + 1);
    setSessionError(null);
  }, [accessToken]);

  const withdrawConsent = useCallback(async () => {
    await SecureStore.deleteItemAsync(CONSENT_KEY);
    await clearBackgroundSyncPilot();
    setConsentAccepted(false);
    await clearImportHistory();
    await clearAutoSyncState();
    await clearBackgroundSchedulerDiagnostic();
    await clearBackgroundHealthReadDiagnostic();
    setConsentGeneration((previous) => previous + 1);
  }, []);

  const forgetSession = useCallback(async () => {
    // Always delete consent first: a failed token deletion must not leave permission in place.
    await SecureStore.deleteItemAsync(CONSENT_KEY);
    await clearBackgroundSyncPilot();
    setConsentAccepted(false);
    await clearImportHistory();
    await clearAutoSyncState();
    await clearBackgroundSchedulerDiagnostic();
    await clearBackgroundHealthReadDiagnostic();
    setConsentGeneration((previous) => previous + 1);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setAccessToken(null);
    setSessionError(null);
  }, []);

  const value = useMemo(() => ({
    accessToken, consentAccepted, consentGeneration, loadingSession, sessionError,
    saveSession, acceptConsent, withdrawConsent, forgetSession,
  }), [accessToken, consentAccepted, consentGeneration, loadingSession, sessionError,
    saveSession, acceptConsent, withdrawConsent, forgetSession]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession requires SessionProvider');
  return value;
}
