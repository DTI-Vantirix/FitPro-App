import React, { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Action, Card, ErrorNotice, Heading, Icon, Label, SectionHeading, StatBlock, StatRow } from '../src/components/Ui';
import { ApiError } from '../src/run/api';
import { Brand, Gated, Loading, Screen } from '../src/run/ui/Screen';
import { joinChallenge, leaveChallenge, loadBoard } from '../src/social/api';
import { daysLeft, formatValue, goalLabel, metricOf, monthWindow, progressPct, type Board, type BoardRow } from '../src/social/challenges';
import { Avatar } from '../src/social/ui/Parts';
import { useSocial, words } from '../src/social/use-social';
import { colors } from '../src/theme';
import { stat, type } from '../src/typography';

function LeaderRow({ row, place, mine, metric, target }: { row: BoardRow; place: number; mine: boolean; metric: string; target: number }) {
  const first = place === 1;
  return <View style={[local.row, mine && local.rowMine]}>
    <View style={local.rowTop}>
      <Text style={[stat(16), local.place, first && { color: colors.accent }]}>{place}</Text>
      <Avatar name={row.name} handle={row.handle} size={32} solid={first} />
      <View style={local.rowText}>
        <Text style={type.bodyStrong} numberOfLines={1}>{row.name}{mine ? '  ·  you' : ''}</Text>
        {!!row.handle && <Label>{`@${row.handle}`}</Label>}
      </View>
      <Text style={stat(18)}>{formatValue(metric, row.value)}</Text>
    </View>
    <View style={local.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progressPct(row.value, target) }}>
      <View style={[local.fill, { width: `${progressPct(row.value, target)}%` }]} />
    </View>
  </View>;
}

/** The website's challenge page: goal, members, days left, your own number, join or leave,
 * and the leaderboard the server adds up. Opened with the challenge's `id`. */
function ChallengeDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { me, loadMe } = useSocial();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const loadId = useRef(0);

  const load = useCallback(async () => {
    if (typeof id !== 'string' || !id) { setError('This challenge is not available.'); return; }
    const turn = loadId.current + 1;
    loadId.current = turn;
    try {
      const { token } = await loadMe();
      const next = await loadBoard(token, id);
      if (turn !== loadId.current) return;
      setBoard(next);
      setError(null);
    } catch (cause) {
      if (turn !== loadId.current) return;
      setError(cause instanceof ApiError && (cause.status === 404 || cause.status === 400) ? 'This challenge is not available.' : words(cause));
    }
  }, [id, loadMe]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function change(join: boolean) {
    if (!me || typeof id !== 'string' || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (join) await joinChallenge(me.token, { challengeId: id, meId: me.account.id, handle: me.profile.handle, name: me.profile.displayName || me.account.fullName || '' });
      else await leaveChallenge(me.token, { challengeId: id, meId: me.account.id });
    } catch (cause) {
      setError(`${join ? 'You were not added to the challenge.' : 'You are still in the challenge.'} ${words(cause)}`);
      setBusy(false);
      return;
    }
    await load();
    setBusy(false);
  }

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace('/challenges'));

  if (!board && !error) return <Loading label="Loading the challenge…" />;

  const challenge = board?.challenge ?? null;
  const metric = metricOf(challenge?.metric);
  const meId = me?.account.id ?? '';
  const myValue = board?.rows.find((row) => row.userId === meId)?.value ?? 0;
  const target = challenge?.targetValue ?? 0;
  const leader = board?.rows[0];

  return <Screen onRefresh={() => { void refresh(); }} refreshing={refreshing}>
    <Brand onBack={back} />
    <SectionHeading kicker="Challenge group" title={challenge?.name ?? 'Challenge'} subtitle={challenge?.description || undefined} />
    <ErrorNotice message={error} />
    {!board && <Action label="Try again" secondary onPress={() => { void refresh(); }} busy={refreshing} />}

    {board && challenge && <>
      <StatRow boxed size={22} items={[
        { label: 'Goal', value: goalLabel(challenge) },
        { label: 'Members', value: String(board.memberCount) },
        { label: 'Days left', value: String(daysLeft(challenge.endDate)) },
      ]} />

      <Card>
        <StatBlock label={`${metric.label} this month`} value={formatValue(challenge.metric, myValue)} caption={monthWindow(challenge.month).label} highlight={board.joined && myValue > 0} />
        <View style={local.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progressPct(myValue, target) }}>
          <View style={[local.fill, { width: `${progressPct(myValue, target)}%` }]} />
        </View>
        {board.joined
          ? <Action label="Leave" icon="log-out" secondary busy={busy} onPress={() => { void change(false); }} />
          : <Action label={busy ? 'Joining…' : 'Join'} icon="check" busy={busy} disabled={!me} onPress={() => { void change(true); }} />}
        {!board.joined && <Text style={type.small}>Joining shows the group your name, your handle and your {metric.label.toLowerCase()} total for the month.</Text>}
      </Card>

      <Card>
        <View style={local.boardTop}>
          <Heading>Leaderboard</Heading>
          <Label>{metric.label}</Label>
        </View>
        {board.rows.length === 0
          ? <Text style={type.small}>Nobody has joined yet — be the first and set the pace.</Text>
          : <View style={local.rows}>
            {board.rows.map((row, index) => <LeaderRow key={row.userId} row={row} place={index + 1} mine={row.userId === meId} metric={challenge.metric} target={target} />)}
          </View>}
        {!!leader && leader.value > 0 && <Label>{`${leader.name} leads`}</Label>}
        <View style={local.privacy}>
          <Icon name="lock" size={14} color={colors.subtle} />
          <Text style={[type.small, local.privacyText]}>Only the {metric.label.toLowerCase()} total is shared here. Splits, routes and per-run timings stay in each athlete's own log.</Text>
        </View>
      </Card>
    </>}
  </Screen>;
}

const local = StyleSheet.create({
  rows: { gap: 8 },
  row: { borderWidth: 1, borderColor: colors.panelBorder, borderRadius: 14, backgroundColor: colors.background, paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  rowMine: { borderColor: colors.accent },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  place: { minWidth: 18, textAlign: 'center', color: colors.subtle },
  rowText: { flex: 1, gap: 2 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.panelBorder, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  boardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  privacy: { flexDirection: 'row', gap: 8, borderWidth: 1, borderColor: colors.panelBorder, borderRadius: 14, padding: 12 },
  privacyText: { flex: 1 },
});

export default function ChallengeScreen() {
  return <Gated><ChallengeDetail /></Gated>;
}
