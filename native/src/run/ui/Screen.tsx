/** Layout and access gate shared by the run screens. */
import React from 'react';
import { Redirect } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { useSession } from '../../auth/session';
import { useAccessGate } from '../../access/access-gate';
import { Action, Card, ErrorNotice, Loading, Screen, ScreenHeader } from '../../components/Ui';
import { colors } from '../../theme';
import { heading, type } from '../../typography';
import { useRunAccount } from '../use-run';

export { Loading, Screen };

/** The horizontal logo at the top of a signed-in screen. */
export function Brand({ onBack }: { onBack?: () => void }) {
  return <ScreenHeader onBack={onBack} />;
}

export function Panel({ children }: { children: React.ReactNode }) {
  return <Card>{children}</Card>;
}

export function Note({ children }: { children: React.ReactNode }) {
  return <Text style={styles.note}>{children}</Text>;
}

/** Everything behind sign-in, consent and an accepted invite — the same three checks, in
 * the same order, as the health-import screens. `setup` also requires zones and a max
 * heart rate, sending a new runner to first-time setup. */
export function Gated({ children, setup = true }: { children: React.ReactNode; setup?: boolean }) {
  const { accessToken, loadingSession, consentAccepted } = useSession();
  const { status, error, refresh } = useAccessGate();
  const account = useRunAccount();

  if (loadingSession) return <Loading />;
  if (!accessToken) return <Redirect href="/" />;
  if (!consentAccepted) return <Redirect href="/consent" />;
  if (status === 'needs_invite' || status === 'blocked') return <Redirect href="/invite" />;
  if (status === 'checking') return <Loading label="Checking your access…" />;
  if (status === 'error' && !account.offlineAccess) {
    return <Screen>
      <Brand />
      <ErrorNotice message={error ?? 'VantraRun could not confirm your access.'} />
      <Note>Your access could not be checked, so nothing is shown. Check your connection and try again. (Once you have opened VantraRun with a connection on this phone, you can start a run without one.)</Note>
      <Action label="Try again" onPress={() => { void refresh(); }} />
    </Screen>;
  }
  if (account.status === 'loading' || account.status === 'blocked') return <Loading label="Loading your account…" />;
  if (account.status === 'offline') {
    return <Screen>
      <Brand />
      <ErrorNotice message={account.error} />
      <Note>VantraRun needs a connection the first time you open it on this phone. After that you can start a run without one.</Note>
      <Action label="Try again" onPress={() => { void account.reload(); }} />
    </Screen>;
  }
  if (setup && account.setupNeeded === true) return <Redirect href="/setup" />;
  if (setup && account.setupNeeded === null) {
    return <Screen>
      <Brand />
      <ErrorNotice message={account.error} />
      <Note>Your zones could not be loaded. Check your connection and try again.</Note>
      <Action label="Try again" onPress={() => { void account.reload(); }} />
    </Screen>;
  }
  return <>{children}</>;
}

export const styles = StyleSheet.create({
  panel: { backgroundColor: colors.panel, borderColor: colors.panelBorder, borderWidth: 1, borderRadius: 22, padding: 18, gap: 10, marginBottom: 14 },
  selected: { borderColor: colors.accent },
  note: { ...type.small, marginTop: 12, marginBottom: 6 },
  muted: { ...type.body },
  label: { ...type.label },
  title: { ...heading(18) },
  body: { ...type.body },
  strong: { ...type.bodyStrong },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  section: { marginTop: 14, marginBottom: 6, gap: 10 },
});
