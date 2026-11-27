import React, { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../src/auth/session';
import { Action, Card, ErrorNotice, Field, Heading, IconButton, Label, Notice, SectionHeading, StatRow } from '../src/components/Ui';
import { applyZones, updateZone } from '../src/run/api';
import { Brand, Gated, Note, Screen } from '../src/run/ui/Screen';
import { useRunAccount } from '../src/run/use-run';
import { formatPace, hrBandLabel, parseZoneEdit, zoneColor, zoneDetails, type Zone } from '../src/run/zones';
import { colors } from '../src/theme';
import { stat, type } from '../src/typography';

const words = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** The runner's five zones and the two numbers they come from, as on the website's Pace
 * zones page. A zone's name and pace range can be changed here; the profile is changed
 * in the setup screen. */
function Zones() {
  const router = useRouter();
  const { accessToken } = useSession();
  const account = useRunAccount();
  const { zones, profile, ownerId, reload } = account;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [fast, setFast] = useState('');
  const [slow, setSlow] = useState('');
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Zones changed on the website, or just now in the profile screen, are picked up on the way in.
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  const hrMax = profile?.hr_max ?? null;
  const threshold = profile?.threshold_sec ?? null;
  const parsed = parseZoneEdit(name, fast, slow);
  const busy = saving || rebuilding;

  function startEdit(zone: Zone) {
    setEditingId(zone.id ?? null);
    setName(zone.name);
    setFast(formatPace(zone.fast_sec));
    setSlow(formatPace(zone.slow_sec));
    setError(null);
  }

  async function save(zoneId: string) {
    if (!accessToken || !parsed.ok) return;
    setSaving(true);
    setError(null);
    try {
      await updateZone(accessToken, zoneId, parsed.values);
      await reload();
      setEditingId(null);
    } catch (cause) {
      setError(`The zone was not changed. ${words(cause)}`);
    } finally {
      setSaving(false);
    }
  }

  async function rebuild() {
    if (!accessToken || !ownerId || !threshold) return;
    setRebuilding(true);
    setError(null);
    setEditingId(null);
    try {
      await applyZones(accessToken, ownerId, threshold);
      await reload();
    } catch (cause) {
      setError(`Your zones were not rebuilt. ${words(cause)}`);
    } finally {
      setRebuilding(false);
    }
  }

  function confirmRebuild() {
    Alert.alert('Rebuild your zones?', `All five zones are set again from your threshold pace of ${formatPace(threshold)} per mile. Names and pace ranges you changed are replaced.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Rebuild', style: 'destructive', onPress: () => { void rebuild(); } },
    ]);
  }

  return <Screen>
    <Brand onBack={() => (router.canGoBack() ? router.back() : router.replace('/settings'))} />
    <SectionHeading kicker="Live pace feedback" title="Pace zones"
      subtitle="Pick a target zone before each run. VantraRun tells you the moment you drift faster or slower than that band." />
    <ErrorNotice message={error} />
    {!!account.error && <Notice>VantraRun could not be reached, so these are the zones saved on this phone. Changes need a connection.</Notice>}

    <Card>
      <Heading>Your profile</Heading>
      <StatRow size={26} items={[
        { label: 'Max heart rate', value: hrMax ? String(Math.round(hrMax)) : '–', unit: 'bpm' },
        { label: 'Threshold pace', value: threshold ? formatPace(threshold) : '–', unit: '/mi' },
      ]} />
      <Action label="Change profile" icon="edit-2" secondary disabled={busy} onPress={() => router.push({ pathname: '/setup', params: { edit: '1' } })} />
      {!!threshold && <Action label="Rebuild zones from threshold pace" icon="refresh-cw" variant="ghost" busy={rebuilding} disabled={saving} onPress={confirmRebuild} />}
    </Card>

    {zones.map((zone) => {
      const details = zoneDetails(zone);
      const band = hrBandLabel(zone, hrMax);
      const number = Number(zone.zone_number);
      const editing = !!zone.id && editingId === zone.id;
      return <Card key={zone.id ?? zone.name} style={local.zone} selected={editing}>
        <View style={[local.bar, { backgroundColor: zoneColor(zone) }]} />
        <Text style={[stat(30), local.number, { color: zoneColor(zone) }]} accessibilityLabel={number >= 1 ? `Zone number ${number}` : 'Custom zone'}>
          {number >= 1 ? number : '–'}
        </Text>
        <View style={local.body}>
          <View style={local.top}>
            <View style={local.names}>
              <Heading>{zone.name}</Heading>
              {!!details.intensity && <Label>{details.intensity}</Label>}
            </View>
            {!!zone.id && !editing && <IconButton icon="edit-2" label={`Edit ${zone.name}`} onPress={() => startEdit(zone)} />}
          </View>
          <View style={local.pace}>
            <Text style={[stat(26), local.paceValue]}>{formatPace(zone.fast_sec)}–{formatPace(zone.slow_sec)}</Text>
            <Label>/mi</Label>
          </View>
          {!!band && <Label>{band}</Label>}
          {!!details.purpose && <Text style={type.body}>{details.purpose}</Text>}
          {!!details.feel && <Text style={type.small}>{details.feel}</Text>}
          {editing && !!zone.id && <View style={local.editor}>
            <Field label="Zone name" value={name} onChangeText={setName} autoCapitalize="sentences" placeholder="Easy" />
            <View style={local.fields}>
              <View style={local.grow}><Field label="Fastest /mi" value={fast} onChangeText={setFast} placeholder="9:00" /></View>
              <View style={local.grow}><Field label="Slowest /mi" value={slow} onChangeText={setSlow} placeholder="10:00" /></View>
            </View>
            {!parsed.ok && <Text style={type.small}>{parsed.error}</Text>}
            <Action label="Save zone" busy={saving} disabled={!parsed.ok || rebuilding} onPress={() => { void save(zone.id as string); }} />
            <Action label="Cancel" secondary disabled={saving} onPress={() => { setEditingId(null); setError(null); }} />
          </View>}
        </View>
      </Card>;
    })}

    <Note>Heart-rate ranges follow your max heart rate. Editing a zone changes its name and pace range only; a run already in progress keeps the zone it started with.</Note>
  </Screen>;
}

const local = StyleSheet.create({
  zone: { flexDirection: 'row', alignItems: 'stretch', gap: 12 },
  bar: { width: 6, borderRadius: 3 },
  number: { minWidth: 18, textAlign: 'center' },
  body: { flex: 1, gap: 6 },
  top: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  names: { flex: 1, gap: 4 },
  pace: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  paceValue: { color: colors.accent },
  editor: { marginTop: 10, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.panelBorder },
  fields: { flexDirection: 'row', gap: 12 },
  grow: { flex: 1 },
});

export default function ZonesScreen() {
  return <Gated><Zones /></Gated>;
}
