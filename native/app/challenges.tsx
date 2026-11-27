import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Action, Card, ErrorNotice, Field, Heading, Icon, IconButton, Label, SectionHeading } from '../src/components/Ui';
import { Brand, Gated, Loading, Screen } from '../src/run/ui/Screen';
import { createChallenge, listChallenges, listJoinedIds } from '../src/social/api';
import { METRICS, METRIC_ORDER, challengeDraft, cleanTarget, daysLeft, goalLabel, metricOf, monthOptions, monthWindow, type Challenge, type MetricId } from '../src/social/challenges';
import { Pill, PillRow, Tag } from '../src/social/ui/Parts';
import { useSocial, words } from '../src/social/use-social';
import { colors } from '../src/theme';
import { type } from '../src/typography';

function ChallengeCard({ challenge, joined, onOpen }: { challenge: Challenge; joined: boolean; onOpen: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${challenge.name}, ${joined ? 'joined' : 'open'}`} onPress={onOpen}
    style={({ pressed }) => pressed && local.pressed}>
    <Card>
      <View style={local.cardTop}>
        <View style={local.cardText}>
          <Heading>{challenge.name}</Heading>
          <Label>{`${monthWindow(challenge.month).label} · ${metricOf(challenge.metric).label}`}</Label>
        </View>
        <Icon name="arrow-right" size={18} color={colors.subtle} />
      </View>
      {!!challenge.description && <Text style={type.small}>{challenge.description}</Text>}
      <View style={local.tags}>
        <Tag label={`goal ${goalLabel(challenge)}`} />
        <Tag label={`${daysLeft(challenge.endDate)}d left`} />
        <View style={local.grow} />
        {joined ? <Tag label="Joined" icon="check" accent /> : <Tag label="Open" icon="users" />}
      </View>
    </Card>
  </Pressable>;
}

/** The website's Challenges page and its New challenge form: one list, each group marked
 * Joined or Open. Runs only: miles run or runs logged. */
function Challenges() {
  const router = useRouter();
  const { me, loadMe } = useSocial();
  const [challenges, setChallenges] = useState<Challenge[] | null>(null);
  const [joined, setJoined] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const months = useMemo(() => monthOptions(3), []);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [metric, setMetric] = useState<MetricId>('distance');
  const [target, setTarget] = useState(METRICS.distance.goalHint);
  const [month, setMonth] = useState(months[0].key);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const loadId = useRef(0);

  const load = useCallback(async () => {
    const id = loadId.current + 1;
    loadId.current = id;
    try {
      const { token, account } = await loadMe();
      const [list, mine] = await Promise.all([listChallenges(token), listJoinedIds(token, account.id)]);
      if (id !== loadId.current) return;
      setChallenges(list);
      setJoined(mine);
      setError(null);
    } catch (cause) {
      if (id !== loadId.current) return;
      setError(words(cause));
    }
  }, [loadMe]);

  // Reloads on the way back from a challenge, where the runner may have joined or left.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function create() {
    if (!me) return;
    const draft = challengeDraft({ name, description, metric, target, month, handle: me.profile.handle });
    if (!draft.ok) { setFormError(draft.error); return; }
    setSaving(true);
    setFormError(null);
    try {
      const created = await createChallenge(me.token, draft.record);
      loadId.current += 1;
      setChallenges((list) => [created, ...(list ?? [])]);
      setName('');
      setDescription('');
      setFormOpen(false);
    } catch (cause) {
      setFormError(`The challenge was not created. ${words(cause)}`);
    } finally {
      setSaving(false);
    }
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace('/home'));
  const open = (challenge: Challenge) => router.push({ pathname: '/challenge', params: { id: challenge.id } });

  if (challenges === null && !error) return <Loading label="Loading challenges…" />;

  return <Screen onRefresh={() => { void refresh(); }} refreshing={refreshing}>
    <Brand onBack={back} />
    <SectionHeading kicker="Group goals" title="Challenges"
      subtitle="Compete on one number a month. The group sees your miles or run count — never your routes, splits or run times." />
    <ErrorNotice message={error} />
    {challenges === null
      ? <Action label="Try again" secondary onPress={() => { void refresh(); }} busy={refreshing} />
      : <>
        {!formOpen && <View style={local.newButton}>
          <Action label="New challenge" icon="plus" compact disabled={!me} onPress={() => { setFormOpen(true); setFormError(null); }} />
        </View>}

        {formOpen && <Card selected>
          <View style={local.cardTop}>
            <Heading>New challenge group</Heading>
            <IconButton icon="x" label="Close the form" onPress={() => setFormOpen(false)} />
          </View>
          <Field label="Group name" value={name} onChangeText={setName} placeholder="November 100" autoCapitalize="sentences" maxLength={60} />
          <Field label="What it's for" value={description} onChangeText={setDescription} placeholder="100 miles before the month is out" autoCapitalize="sentences" maxLength={140} />
          <Label>Competes on</Label>
          <PillRow>
            {METRIC_ORDER.map((id) => <Pill key={id} label={METRICS[id].label} selected={metric === id}
              onPress={() => { setMetric(id); setTarget(METRICS[id].goalHint); }} />)}
          </PillRow>
          <Text style={type.small}>Only this number is ever shown to the group — routes, splits and run times stay private.</Text>
          <View style={local.fieldGap} />
          <Field label={`Monthly goal (${METRICS[metric].unit})`} value={target} onChangeText={(value) => setTarget(cleanTarget(value))} keyboardType="decimal-pad" maxLength={7} />
          <Label>Month</Label>
          <PillRow>
            {months.map((option) => <Pill key={option.key} label={option.label} selected={month === option.key} onPress={() => setMonth(option.key)} />)}
          </PillRow>
          <ErrorNotice message={formError} />
          <Action label={saving ? 'Creating…' : 'Create challenge'} busy={saving} disabled={!name.trim() || !target} onPress={() => { void create(); }} />
        </Card>}

        {challenges.length === 0 && <Card style={local.empty}>
          <View style={local.trophy}><Ionicons name="trophy-outline" size={26} color={colors.accent} /></View>
          <Heading style={local.center}>No challenge groups yet</Heading>
          <Text style={[type.body, local.center]}>Start one for the month — a 100 mile goal or 20 runs — and anyone who joins climbs the same board.</Text>
        </Card>}

        {challenges.map((challenge) => <ChallengeCard key={challenge.id} challenge={challenge} joined={joined.includes(challenge.id)} onOpen={() => open(challenge)} />)}
      </>}
  </Screen>;
}

const local = StyleSheet.create({
  pressed: { opacity: 0.7 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  cardText: { flex: 1, gap: 4 },
  tags: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  grow: { flex: 1 },
  newButton: { alignItems: 'flex-start', marginBottom: 16 },
  fieldGap: { height: 6 },
  empty: { alignItems: 'stretch', paddingVertical: 28, gap: 12 },
  trophy: { alignItems: 'center' },
  center: { textAlign: 'center' },
});

export default function ChallengesScreen() {
  return <Gated><Challenges /></Gated>;
}
