import React, { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../src/auth/session';
import { Action, Card, ErrorNotice, Field, Heading, Icon, IconButton, Label, Notice, SectionHeading, StatRow } from '../src/components/Ui';
import { applyZones, createZone, deleteZone, updateZone } from '../src/run/api';
import { Brand, Gated, Note, Screen } from '../src/run/ui/Screen';
import { useRunAccount } from '../src/run/use-run';
import { ZONE_COLORS, formatPace, hrBandLabel, isStandardZone, newZone, parseZoneEdit, zoneColor, zoneDetails, type Zone } from '../src/run/zones';
import { colors } from '../src/theme';
import { stat, type } from '../src/typography';

const words = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
/** The website's zone editor starts a new zone on the second colour of the ramp. */
const FIRST_COLOR = ZONE_COLORS[1];
const COLOR_NAMES = ['Steel', 'Light steel', 'Chalk', 'Dim Volt', 'Volt'];

/** The runner's zones and the two numbers they come from, as on the website's Pace zones
 * page. A zone's name and pace range can be changed here, a zone of the runner's own added
 * and any zone deleted; the profile is changed in the setup screen. */
function Zones() {
  const router = useRouter();
  const { accessToken } = useSession();
  const account = useRunAccount();
  const { zones, profile, ownerId, reload } = account;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [fast, setFast] = useState('');
  const [slow, setSlow] = useState('');
  const [color, setColor] = useState(FIRST_COLOR);
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Zones changed on the website, or just now in the profile screen, are picked up on the way in.
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  const hrMax = profile?.hr_max ?? null;
  const threshold = profile?.threshold_sec ?? null;
  const parsed = parseZoneEdit(name, fast, slow);
  const created = newZone(name, fast, slow, color, zones.length);
  const busy = saving || rebuilding || deletingId !== null;
  // A rebuild writes the five standard zones and nothing else, as on the website.
  const ownZones = zones.some((zone) => !isStandardZone(zone));

  function startEdit(zone: Zone) {
    setAdding(false);
    setEditingId(zone.id ?? null);
    setName(zone.name);
    setFast(formatPace(zone.fast_sec));
    setSlow(formatPace(zone.slow_sec));
    setError(null);
  }

  function startAdd() {
    setEditingId(null);
    setAdding(true);
    setName('');
    setFast('');
    setSlow('');
    setColor(FIRST_COLOR);
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

  async function add() {
    if (!accessToken || !created.ok) return;
    setSaving(true);
    setError(null);
    try {
      await createZone(accessToken, created.values);
      await reload();
      setAdding(false);
    } catch (cause) {
      setError(`The zone was not added. ${words(cause)}`);
    } finally {
      setSaving(false);
    }
  }

  async function remove(zone: Zone) {
    if (!accessToken || !zone.id) return;
    setDeletingId(zone.id);
    setError(null);
    setEditingId(null);
    try {
      await deleteZone(accessToken, zone.id);
    } catch (cause) {
      setError(`${zone.name} was not deleted. ${words(cause)}`);
    }
    // Read again whatever happened, so the list is what the server holds.
    await reload();
    setDeletingId(null);
  }

  function confirmRemove(zone: Zone) {
    const last = zones.length === 1;
    const detail = last
      ? 'It is your only zone. Without one VantraRun cannot coach a run, so you will be asked to set your zones again.'
      : isStandardZone(zone)
        ? 'It is one of the five zones built from your threshold pace. Rebuilding your zones brings it back.'
        : 'It is a zone you added, and deleting it cannot be undone.';
    Alert.alert(`Delete ${zone.name}?`, `${detail} Routes that target it fall back to another zone. A run already in progress keeps it.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { void remove(zone); } },
    ]);
  }

  async function rebuild() {
    if (!accessToken || !ownerId || !threshold) return;
    setRebuilding(true);
    setError(null);
    setEditingId(null);
    setAdding(false);
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
    Alert.alert('Rebuild your zones?', `All five zones are set again from your threshold pace of ${formatPace(threshold)} per mile. Names and pace ranges you changed are replaced${ownZones ? ', and zones you added yourself are removed' : ''}.`, [
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
      {!!threshold && <Action label="Rebuild zones from threshold pace" icon="refresh-cw" variant="ghost" busy={rebuilding} disabled={saving || deletingId !== null} onPress={confirmRebuild} />}
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
              {!isStandardZone(zone) && <Label>Your own zone · pace only</Label>}
            </View>
            {!!zone.id && !editing && <View style={local.buttons}>
              <IconButton icon="edit-2" label={`Edit ${zone.name}`} onPress={() => { if (!busy) startEdit(zone); }} />
              <IconButton icon="trash-2" label={`Delete ${zone.name}`} onPress={() => { if (!busy) confirmRemove(zone); }} />
            </View>}
          </View>
          <View style={local.pace}>
            <Text style={[stat(26), local.paceValue]}>{formatPace(zone.fast_sec)}–{formatPace(zone.slow_sec)}</Text>
            <Label>/mi</Label>
          </View>
          {!!band && <Label>{band}</Label>}
          {!!details.purpose && <Text style={type.body}>{details.purpose}</Text>}
          {!!details.feel && <Text style={type.small}>{details.feel}</Text>}
          {deletingId === zone.id && <Text style={type.small}>Deleting…</Text>}
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

    {adding
      ? <Card selected>
        <Heading>New pace zone</Heading>
        <Text style={type.small}>A zone of your own, by pace. It has no heart-rate range, so during a run it coaches your pace only.</Text>
        <Field label="Zone name" value={name} onChangeText={setName} autoCapitalize="sentences" placeholder="Easy" />
        <View style={local.fields}>
          <View style={local.grow}><Field label="Fastest /mi" value={fast} onChangeText={setFast} placeholder="9:00" /></View>
          <View style={local.grow}><Field label="Slowest /mi" value={slow} onChangeText={setSlow} placeholder="10:00" /></View>
        </View>
        <Label>Colour</Label>
        <View style={local.swatches}>
          {ZONE_COLORS.map((choice, index) => <Pressable key={choice} accessibilityRole="button" accessibilityLabel={`Use colour ${COLOR_NAMES[index]}`}
            accessibilityState={{ selected: color === choice }} hitSlop={6} onPress={() => setColor(choice)}
            style={[local.swatch, { backgroundColor: choice }, color === choice && local.swatchPicked]}>
            {color === choice && <Icon name="check" size={16} color={colors.accentText} />}
          </Pressable>)}
        </View>
        {!created.ok && (name !== '' || fast !== '' || slow !== '') && <Text style={type.small}>{created.error}</Text>}
        <Action label="Save zone" busy={saving} disabled={!created.ok || rebuilding || deletingId !== null} onPress={() => { void add(); }} />
        <Action label="Cancel" secondary disabled={saving} onPress={() => { setAdding(false); setError(null); }} />
      </Card>
      : <Action label="Add a zone" icon="plus" secondary disabled={busy} onPress={startAdd} />}

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
  buttons: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pace: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  paceValue: { color: colors.accent },
  editor: { marginTop: 10, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.panelBorder },
  fields: { flexDirection: 'row', gap: 12 },
  grow: { flex: 1 },
  swatches: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: colors.panelBorder, alignItems: 'center', justifyContent: 'center' },
  swatchPicked: { borderColor: colors.accent, transform: [{ scale: 1.1 }] },
});

export default function ZonesScreen() {
  return <Gated><Zones /></Gated>;
}
