/** Who is signed in, for the social screens: the account and its social profile. The profile
 * is created the first time it is needed, as on the website. */
import { useCallback, useRef, useState } from 'react';
import { useSession } from '../auth/session';
import { fetchAccount, loadMyProfile, type Account } from './api';
import type { SocialProfile } from './logic';

export const words = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export type Me = { token: string; account: Account; profile: SocialProfile };

export function useSocial(): {
  me: Me | null;
  /** Loads (or reloads) the account and profile. Throws the plain sentence to show when it cannot. */
  loadMe: () => Promise<Me>;
  setProfile: (profile: SocialProfile) => void;
} {
  const { accessToken } = useSession();
  const [me, setMe] = useState<Me | null>(null);
  const latest = useRef(0);

  const loadMe = useCallback(async () => {
    if (!accessToken) throw new Error('You are signed out. Sign in again.');
    const id = latest.current + 1;
    latest.current = id;
    const account = await fetchAccount(accessToken);
    const profile = await loadMyProfile(accessToken, account);
    const next = { token: accessToken, account, profile };
    if (id === latest.current) setMe(next);
    return next;
  }, [accessToken]);

  const setProfile = useCallback((profile: SocialProfile) => {
    setMe((current) => (current ? { ...current, profile } : current));
  }, []);

  // A profile loaded under another sign-in is never shown.
  return { me: me && me.token === accessToken ? me : null, loadMe, setProfile };
}
