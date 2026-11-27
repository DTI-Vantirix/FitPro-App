import React, { useState } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { useSession } from '../src/auth/session';
import { Action, AuthHero, ErrorNotice, Field, Heading, Label, Notice, ScreenHeader, StatRow } from '../src/components/Ui';
import { applyZones, saveProfile } from '../src/run/api';
import { Gated, Note, Panel, Screen, styles } from '../src/run/ui/Screen';
import { useRunAccount } from '../src/run/use-run';
import { estimateHrMax, estimateZones, formatPace, hasBody, isStandardZone, parseBody, parsePace, profileChange, thresholdOverride, validHrMax, zoneTemplate } from '../src/run/zones';
import { Pill, PillRow } from '../src/social/ui/Parts';

const typed = (value: number | null | undefined) => (value == null ? '' : String(value));

/** First-time setup: the two numbers the zones are built from. Writes the same five
 * zones the website's onboarding writes. Opened with `?edit=1` from the Pace zones screen it
 * changes the profile later: the same form, with a way back.
 *
 * The two numbers are either typed in, or estimated from age, sex, height and weight as the
 * website's profile form does; the estimate saves the same profile fields the website saves. */
function Setup() {
  const router = useRouter();
  const { accessToken } = useSession();
  const account = useRunAccount();
  const editing = useLocalSearchParams<{ edit?: string }>().edit === '1';
  const known = account.profile;
  // A profile that already holds body numbers (saved here or on the website) opens on them.
  const [estimating, setEstimating] = useState(() => hasBody(known));
  const [hrMax, setHrMax] = useState(known?.hr_max ? String(Math.round(known.hr_max)) : '');
  const [age, setAge] = useState(typed(known?.age));
  const [sex, setSex] = useState<string>(known?.sex ?? '');
  const [height, setHeight] = useState(typed(known?.height_in));
  const [weight, setWeight] = useState(typed(known?.weight_lb));
  const [override, setOverride] = useState(() => thresholdOverride(known));
  const startPace = known?.threshold_sec ? formatPace(known.threshold_sec).split(':') : ['', ''];
  const [minutes, setMinutes] = useState(startPace[0]);
  const [seconds, setSeconds] = useState(startPace[1]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (account.setupNeeded === false && !busy && !editing) return <Redirect href="/home" />;

  const hr = Number(hrMax);
  const hrOk = hrMax.trim() !== '' && validHrMax(hr);
  // Zones made on the website are the runner's own: only the missing max heart rate is asked for.
  const hasZones = account.zones.length > 0;
  // The threshold pace is asked for when there are no zones yet, and offered when changing the profile.
  const askPace = !hasZones || editing;

  // Typed in: max heart rate, and the threshold pace as minutes and seconds.
  const threshold = parsePace(`${minutes.trim() || '0'}:${seconds.trim().padStart(2, '0') || '00'}`);
  const paceTyped = minutes.trim() !== '' || seconds.trim() !== '';
  // Estimated: the body numbers, and optionally the runner's own threshold pace over the estimate.
  const body = parseBody(age, sex, height, weight);
  const bodyTouched = age.trim() !== '' || sex !== '' || height.trim() !== '' || weight.trim() !== '';
  const estimate = body.ok ? estimateZones(body.values) : null;
  const overrideTyped = override.trim() !== '';
  const overrideSec = parsePace(override);

  const plan = estimating
    ? body.ok && !(askPace && overrideTyped && !overrideSec)
      ? profileChange({ hrMax: 0, thresholdSec: askPace ? overrideSec : null, known, hasZones, body: body.values, keepPace: !askPace })
      : null
    : hrOk && !(askPace && paceTyped && !threshold)
      ? profileChange({ hrMax: hr, thresholdSec: askPace ? threshold : null, known, hasZones })
      : null;
  const preview = plan?.rebuildZones && plan.values.threshold_sec ? zoneTemplate(plan.values.threshold_sec) : null;
  const previewHr = plan?.values.hr_max ?? 0;
  // A rebuild writes the five standard zones and nothing else, as on the website.
  const ownZones = account.zones.some((zone) => !isStandardZone(zone));

  function estimateFromAge() {
    const value = estimateHrMax(Number(age));
    if (value == null) setError('Enter an age between 12 and 90 to estimate.');
    else { setError(null); setHrMax(String(value)); }
  }

  async function save() {
    if (!accessToken || !account.ownerId || !plan) return;
    setBusy(true);
    setError(null);
    try {
      await saveProfile(accessToken, account.ownerId, plan.values);
      if (plan.rebuildZones && plan.values.threshold_sec) await applyZones(accessToken, account.ownerId, plan.values.threshold_sec);
      await account.reload();
      if (editing && router.canGoBack()) router.back();
      else router.replace('/home');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  return <Screen>
    {editing && <ScreenHeader onBack={() => (router.canGoBack() ? router.back() : router.replace('/home'))} />}
    <AuthHero title={editing ? 'Your profile' : hasZones ? 'Your max heart rate' : 'Set your zones'}
      subtitle={editing
        ? 'Your max heart rate sets the heart-rate range of every zone. Your threshold pace is what the five zones are built from.'
        : hasZones
        ? 'You already have zones. VantraRun needs your max heart rate to turn each zone into a heart-rate range. Your zones are not changed.'
        : 'Two numbers. VantraRun builds five training zones from them, each with its own pace range and heart-rate range.'} />
    <ErrorNotice message={error ?? account.error} />
    <PillRow>
      <Pill label="I know my numbers" icon="edit-3" grow selected={!estimating} disabled={busy} onPress={() => { setEstimating(false); setError(null); }} />
      <Pill label="Estimate them for me" icon="activity" grow selected={estimating} disabled={busy} onPress={() => { setEstimating(true); setError(null); }} />
    </PillRow>

    {estimating ? <>
      <Text style={[styles.body, { marginTop: 12, marginBottom: 12 }]}>
        Age, sex, height and weight give VantraRun your max heart rate{askPace ? ', VO₂ max and threshold pace' : ' and VO₂ max'}, the same way the website does. It is an estimate: measured numbers are better if you have them.
      </Text>
      <View style={styles.row}>
        <View style={{ flex: 1 }}><Field label="Age" value={age} onChangeText={setAge} keyboardType="number-pad" /></View>
        <View style={{ flex: 1, gap: 8, marginBottom: 16 }}>
          <Label>Sex</Label>
          <PillRow>
            <Pill label="Male" grow selected={sex === 'male'} disabled={busy} onPress={() => setSex('male')} />
            <Pill label="Female" grow selected={sex === 'female'} disabled={busy} onPress={() => setSex('female')} />
          </PillRow>
        </View>
      </View>
      <View style={styles.row}>
        <View style={{ flex: 1 }}><Field label="Height (in)" value={height} onChangeText={setHeight} keyboardType="decimal-pad" /></View>
        <View style={{ flex: 1 }}><Field label="Weight (lb)" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" /></View>
      </View>
      {bodyTouched && !body.ok && <Text style={[styles.body, { marginBottom: 12 }]}>{body.error}</Text>}
      {estimate && <Panel>
        <Heading size={16}>Your estimate</Heading>
        <StatRow size={24} items={[
          { label: 'Max HR', value: String(estimate.hr_max), unit: 'bpm' },
          { label: 'VO₂ max', value: String(estimate.vo2max), unit: 'ml/kg' },
          ...(askPace ? [{ label: 'Threshold', value: formatPace(overrideSec ?? estimate.threshold_sec), unit: '/mi' }] : []),
        ]} />
      </Panel>}
      {askPace && <>
        <Field label="Your own threshold pace, per mile (optional)" value={override} onChangeText={setOverride}
          placeholder={estimate ? formatPace(estimate.threshold_sec) : '8:30'} />
        <Text style={[styles.body, { marginBottom: 12 }]}>
          {overrideTyped && !overrideSec
            ? 'Enter a pace between 3:00 and 20:00 per mile, as minutes:seconds.'
            : 'The pace you could hold for about an hour. Leave it empty to use the estimate.'}
        </Text>
      </>}
    </> : <>
      <View style={{ height: 12 }} />
      <Field label="Max heart rate (bpm)" value={hrMax} onChangeText={setHrMax} keyboardType="number-pad" />
      {hrMax.trim() !== '' && !hrOk && <Text style={styles.body}>Enter a whole number between 100 and 230.</Text>}
      <Panel>
        <Heading size={16}>Don't know it?</Heading>
        <Text style={styles.body}>Enter your age for an estimate (208 − 0.7 × age). A measured value is better if you have one.</Text>
        <Field label="Age" value={age} onChangeText={setAge} keyboardType="number-pad" />
        <Action label="Estimate from age" onPress={estimateFromAge} secondary disabled={!age.trim()} />
      </Panel>
      {askPace && <>
        <Heading size={16}>Threshold pace, per mile</Heading>
        <Text style={[styles.body, { marginTop: 6, marginBottom: 12 }]}>The pace you could hold for about an hour of hard running.</Text>
        <View style={styles.row}>
          <View style={{ flex: 1 }}><Field label="Minutes" value={minutes} onChangeText={setMinutes} keyboardType="number-pad" /></View>
          <View style={{ flex: 1 }}><Field label="Seconds" value={seconds} onChangeText={setSeconds} keyboardType="number-pad" /></View>
        </View>
        {paceTyped && !threshold &&
          <Text style={styles.body}>Enter a pace between 3:00 and 20:00 per mile.</Text>}
      </>}
    </>}

    {hasZones && !!plan?.rebuildZones && <Notice>
      Saving rebuilds all five zones from this threshold pace{plan.values.threshold_sec ? ` (${formatPace(plan.values.threshold_sec)} per mile)` : ''}. Names and pace ranges you changed are replaced{ownZones ? ', and zones you added yourself are removed' : ''}.
    </Notice>}
    {editing && hasZones && !!plan && !plan.rebuildZones && <Text style={[styles.body, { marginBottom: 12 }]}>Your zones are not changed unless you change the threshold pace.</Text>}
    {preview && <Panel>
      <Heading size={16}>Your zones</Heading>
      {preview.map((zone) => <View key={zone.zone_number} style={styles.row}>
        <Text style={styles.strong}>{zone.name}</Text>
        <Text style={styles.body}>
          {formatPace(zone.fast_sec)}–{formatPace(zone.slow_sec)} /mi · {Math.round((previewHr * zone.hr_min_pct!) / 100)}–{Math.round((previewHr * zone.hr_max_pct!) / 100)} bpm
        </Text>
      </View>)}
    </Panel>}
    <Action label={editing ? 'Save' : 'Save and continue'} onPress={() => { void save(); }} busy={busy} disabled={!plan} />
    {!editing && <Note>You can change your zones later in Settings, under Pace zones.</Note>}
  </Screen>;
}

export default function SetupScreen() {
  return <Gated setup={false}><Setup /></Gated>;
}
