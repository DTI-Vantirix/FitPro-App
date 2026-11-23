import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'fitpro.native.user.access_token';

type SessionContextValue = {
  accessToken: string | null;
  loadingSession: boolean;
  sessionError: string | null;
  saveSession: (token: string) => Promise<void>;
  forgetSession: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    SecureStore.getItemAsync(TOKEN_KEY)
      .then((saved) => {
        if (mounted) setAccessToken(saved);
      })
      .catch((error: unknown) => {
        if (mounted) setSessionError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (mounted) setLoadingSession(false);
      });
    return () => { mounted = false; };
  }, []);

  const saveSession = useCallback(async (token: string) => {
    if (!token) throw new Error('Refusing to store an empty user token.');
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    setSessionError(null);
    setAccessToken(token);
  }, []);

  const forgetSession = useCallback(async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setAccessToken(null);
    setSessionError(null);
  }, []);

  const value = useMemo(() => ({
    accessToken, loadingSession, sessionError, saveSession, forgetSession,
  }), [accessToken, loadingSession, sessionError, saveSession, forgetSession]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession requires SessionProvider');
  return value;
}
