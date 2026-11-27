import React, { useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { useSession } from '../src/auth/session';
import { Action, AuthHero, ErrorNotice, Field, Heading } from '../src/components/Ui';
import { applyZones, saveProfile } from '../src/run/api';
import { Gated, Note, Panel, Screen, styles } from '../src/run/ui/Screen';
import { useRunAccount } from '../src/run/use-run';
import { estimateHrMax, formatPace, parsePace, validHrMax, zoneTemplate } from '../src/run/zones';

/** First-time setup: the two numbers the zones are built from. Writes the same five
 * zones the website's onboarding writes. */
function Setup() {
  const router = useRouter();
  const { accessToken } = useSession();
  const account = useRunAccount();
  const known = account.profile;
  const [hrMax, setHrMax] = useState(known?.hr_max ? String(Math.round(known.hr_max)) : '');
  const [age, setAge] = useState('');
  const startPace = known?.threshold_sec ? formatPace(known.threshold_sec).split(':') : ['', ''];
  const [minutes, setMinutes] = useState(startPace[0]);
  const [seconds, setSeconds] = useState(startPace[1]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (account.setupNeeded === false && !busy) return <Redirect href="/home" />;

  const hr = Number(hrMax);
  const threshold = parsePace(`${minutes.trim() || '0'}:${seconds.trim().padStart(2, '0') || '00'}`);
  const hrOk = hrMax.trim() !== '' && validHrMax(hr);
  // Zones made on the website are the runner's own: only the missing max heart rate is asked for.
  const hasZones = account.zones.length > 0;
  const preview = threshold ? zoneTemplate(threshold) : null;

  function estimate() {
    const value = estimateHrMax(Number(age));
    if (value == null) setError('Enter an age between 12 and 90 to estimate.');
    else { setError(null); setHrMax(String(value)); }
  }

  async function save() {
    if (!accessToken || !account.ownerId || !hrOk || (!hasZones && !threshold)) return;
    setBusy(true);
    setError(null);
    try {
      if (hasZones || !threshold) {
        await saveProfile(accessToken, account.ownerId, { hr_max: hr });
      } else {
        await saveProfile(accessToken, account.ownerId, { hr_max: hr, threshold_sec: threshold });
        await applyZones(accessToken, account.ownerId, threshold);
      }
      await account.reload();
      router.replace('/home');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  return <Screen>
    <AuthHero title={hasZones ? 'Your max heart rate' : 'Set your zones'}
      subtitle={hasZones
        ? 'You already have zones. VantraRun needs your max heart rate to turn each zone into a heart-rate range. Your zones are not changed.'
        : 'Two numbers. VantraRun builds five training zones from them, each with its own pace range and heart-rate range.'} />
    <ErrorNotice message={error ?? account.error} />
    <Field label="Max heart rate (bpm)" value={hrMax} onChangeText={setHrMax} keyboardType="number-pad" />
    {hrMax.trim() !== '' && !hrOk && <Text style={styles.body}>Enter a whole number between 100 and 230.</Text>}
    <Panel>
      <Heading size={16}>Don't know it?</Heading>
      <Text style={styles.body}>Enter your age for an estimate (208 − 0.7 × age). A measured value is better if you have one.</Text>
      <Field label="Age" value={age} onChangeText={setAge} keyboardType="number-pad" />
      <Action label="Estimate from age" onPress={estimate} secondary disabled={!age.trim()} />
    </Panel>
    {!hasZones && <>
    <Heading size={16}>Threshold pace, per mile</Heading>
    <Text style={[styles.body, { marginTop: 6, marginBottom: 12 }]}>The pace you could hold for about an hour of hard running.</Text>
    <View style={styles.row}>
      <View style={{ flex: 1 }}><Field label="Minutes" value={minutes} onChangeText={setMinutes} keyboardType="number-pad" /></View>
      <View style={{ flex: 1 }}><Field label="Seconds" value={seconds} onChangeText={setSeconds} keyboardType="number-pad" /></View>
    </View>
    {(minutes.trim() !== '' || seconds.trim() !== '') && !threshold &&
      <Text style={styles.body}>Enter a pace between 3:00 and 20:00 per mile.</Text>}
    </>}
    {!hasZones && preview && hrOk && <Panel>
      <Heading size={16}>Your zones</Heading>
      {preview.map((zone) => <View key={zone.zone_number} style={styles.row}>
        <Text style={styles.strong}>{zone.name}</Text>
        <Text style={styles.body}>
          {formatPace(zone.fast_sec)}–{formatPace(zone.slow_sec)} /mi · {Math.round((hr * zone.hr_min_pct!) / 100)}–{Math.round((hr * zone.hr_max_pct!) / 100)} bpm
        </Text>
      </View>)}
    </Panel>}
    <Action label="Save and continue" onPress={() => { void save(); }} busy={busy} disabled={!hrOk || (!hasZones && !threshold)} />
    <Note>You can change zones later on the website.</Note>
  </Screen>;
}

export default function SetupScreen() {
  return <Gated setup={false}><Setup /></Gated>;
}
