/** Step 7B.1: read-only developer readiness view. It does NOT register OS tasks,
 * request new permissions, persist a background opt-in, or upload health data.
 */
import React, { useMemo } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import {
  backgroundBlockers, CURRENT_BACKGROUND_FOUNDATION,
  type BackgroundPlatform, type BackgroundProvider,
} from './background-sync-policy';

type Props = Readonly<{
  provider: BackgroundProvider;
  signedIn: boolean;
  consentAccepted: boolean;
  inviteVerified: boolean;
}>;

export function BackgroundReadinessPanel({ provider, signedIn, consentAccepted, inviteVerified }: Props) {
  const platform: BackgroundPlatform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'other';
  const blockers = useMemo(() => backgroundBlockers({
    platform, provider, signedIn, consentAccepted, inviteVerified, ...CURRENT_BACKGROUND_FOUNDATION,
  }), [platform, provider, signedIn, consentAccepted, inviteVerified]);
  return <View style={styles.panel}>
    <Text style={styles.kicker}>STEP 7B.1 · BACKGROUND READINESS</Text>
    <Text style={styles.title}>Historical Step 7B.1 foundation snapshot</Text>
    <Text style={styles.note}>This is the original Step 7B.1 readiness checklist, not the current sync state. See Step 7B.2C below for the actual background upload opt-in and report.</Text>
    <Text style={styles.info}>Platform: {platform} · Provider: {provider}</Text>
    <Text style={styles.info}>Historical foundation blockers: {blockers.length}</Text>
    {blockers.map((reason) => <Text key={reason} style={styles.reason}>• {reason}</Text>)}
    <Text style={styles.note}>This historical baseline is preserved for reference. New background synchronization status is displayed in the Step 7B.2C panel.</Text>
    <Text style={styles.disclaimer}>DEV FOUNDATION ONLY · No background health-sync tasks scheduled at Step 7B.1 · No new permissions requested</Text>
  </View>;
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderColor: colors.panelBorder, borderRadius: 14, backgroundColor: colors.panel,
    padding: 16, marginTop: 12, marginBottom: 20, gap: 8 },
  kicker: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.3 },
  title: { color: colors.text, fontSize: 17, fontWeight: '800' },
  note: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  info: { color: colors.text, fontSize: 12, lineHeight: 18 },
  reason: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  disclaimer: { color: colors.subtle, fontSize: 10, lineHeight: 17, marginTop: 4 },
});
