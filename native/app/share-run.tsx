import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Action, Card, ErrorNotice, Field, Heading, Label, Notice, SectionHeading } from '../src/components/Ui';
import { WEB_URL } from '../src/config';
import { listRunsToShare } from '../src/run/api';
import { Brand, Gated, Loading, Note, Screen } from '../src/run/ui/Screen';
import { useRunAccount } from '../src/run/use-run';
import { createPost } from '../src/social/api';
import { AUDIENCES, buildPost, defaultAudience, postLink, postText, thinTrack, type Audience, type Post, type ShareRun } from '../src/social/logic';
import { Pill, PillRow, RunStatsCard } from '../src/social/ui/Parts';
import { useSocial, words } from '../src/social/use-social';
import { colors } from '../src/theme';
import { type } from '../src/typography';

type Run = ShareRun & { externalId: string | null; startedAt: string | null };

const AUDIENCE_NOTE: Record<Audience, string> = {
  public: 'Anyone on VantraRun can see this post.',
  friends: 'Only your accepted friends can see this post.',
  private: 'Only you can see this post.',
};

/** The website's New post composer without photo or video backgrounds: pick a run, add a
 * caption, choose who sees it, post. Opened with `run` (the server's id of a run) or `ext`
 * (the id the phone gave a run it recorded) to start on that run. */
function ShareRunScreenBody() {
  const router = useRouter();
  const params = useLocalSearchParams<{ run?: string; ext?: string }>();
  const wantedId = typeof params.run === 'string' ? params.run : null;
  const wantedExt = typeof params.ext === 'string' ? params.ext : null;
  const asked = Boolean(wantedId || wantedExt);
  const { ownerId } = useRunAccount();
  const { me, loadMe } = useSocial();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  // Null until the runner picks: then the default follows their account (friends, or public for a public account).
  const [picked, setPicked] = useState<Audience | null>(null);
  const [posting, setPosting] = useState(false);
  const [created, setCreated] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ownerId) return;
    setError(null);
    try {
      const { token } = await loadMe();
      // The website offers the latest 8 runs; a run asked for by id may be a little older.
      const list = await listRunsToShare(token, ownerId, { limit: asked ? 40 : 8 });
      setRuns(list);
      const wanted = list.find((run) => (wantedId && run.id === wantedId) || (wantedExt && run.externalId === wantedExt));
      setSelectedId((current) => current ?? wanted?.id ?? null);
    } catch (cause) {
      setError(words(cause));
      setRuns((current) => current ?? []);
    }
  }, [ownerId, loadMe, asked, wantedId, wantedExt]);

  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(() => (runs ?? []).find((run) => run.id === selectedId) ?? null, [runs, selectedId]);
  const track = useMemo(() => thinTrack(selected?.points), [selected]);
  const audience: Audience = picked ?? defaultAudience(me?.profile);

  async function post() {
    if (!me || !selected || posting || created) return;
    setPosting(true);
    setError(null);
    try {
      setCreated(await createPost(me.token, buildPost({ run: selected, caption, audience, profile: me.profile })));
    } catch (cause) {
      setError(`The run was not posted. ${words(cause)}`);
    } finally {
      setPosting(false);
    }
  }

  function shareOut(made: Post) {
    const link = postLink(WEB_URL, made.id);
    void Share.share({ message: link ? `${postText(made)}\n${link}` : postText(made) }).catch(() => {});
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace('/feed'));

  if (runs === null || (!me && !error)) return <Loading label="Loading your runs…" />;

  return <Screen>
    <Brand onBack={back} nav={false} />
    <SectionHeading kicker="Share a run" title="New post" subtitle="Nothing is ever posted automatically. Every run you share is one you pick." />
    <ErrorNotice message={error} />
    {!!error && !created && <Action label="Try again" secondary onPress={() => { void load(); }} />}

    {created
      ? <>
        <Notice icon="check">Posted. {AUDIENCE_NOTE[created.visibility as Audience] ?? ''}</Notice>
        <RunStatsCard distanceMi={created.distanceMi} avgPaceSec={created.avgPaceSec} durationSec={created.durationSec} zoneName={created.zoneName}
          title={created.title} points={created.routePoints} />
        <Action label="Go to the feed" onPress={() => router.replace('/feed')} />
        <Action label="Send it somewhere else…" icon="share-2" secondary onPress={() => shareOut(created)} />
        <Note>"Send it somewhere else" opens your phone's share sheet with the distance, the zone and a link. Only you decide where it goes.</Note>
      </>
      : <>
        {runs.length === 0 && !error && <Notice>Nothing logged yet — record a run first.</Notice>}
        {asked && runs.length > 0 && !selected && <Notice>That run is not on VantraRun yet, or is older than your latest runs. Pick one of these instead.</Notice>}

        {runs.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} style={local.picker} contentContainerStyle={local.pickerContent}>
          {runs.slice(0, asked && selected ? 40 : 8).map((run) => {
            const on = run.id === selectedId;
            return <Pressable key={run.id} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setSelectedId(run.id)}
              style={({ pressed }) => pressed && local.pressed}>
              <Card selected={on} style={local.runChip}>
                <Text style={[type.bodyStrong, on && { color: colors.accent }]} numberOfLines={1}>{run.routeName || 'Free run'}</Text>
                <Label>{`${run.distanceMi.toFixed(2)} mi${run.startedAt ? ` · ${new Date(run.startedAt).toLocaleDateString()}` : ''}`}</Label>
              </Card>
            </Pressable>;
          })}
        </ScrollView>}

        {selected && <>
          <RunStatsCard distanceMi={selected.distanceMi} avgPaceSec={selected.avgPaceSec} durationSec={selected.durationSec}
            zoneName={selected.targetZoneName ?? ''} title={selected.routeName || 'Free run'} points={track} />
          <View style={local.gap} />
          <Field label="Caption" value={caption} onChangeText={setCaption} placeholder="Legs felt heavy, kept it easy." autoCapitalize="sentences" multiline maxLength={500} />

          <Heading size={16}>Who sees it</Heading>
          <View style={local.audience}>
            <PillRow>
              {AUDIENCES.map((choice) => <Pill key={choice.id} label={choice.label} icon={choice.icon} selected={audience === choice.id}
                disabled={posting} onPress={() => setPicked(choice.id)} />)}
            </PillRow>
            <Text style={type.small}>{AUDIENCE_NOTE[audience]}</Text>
          </View>

          <Action label={posting ? 'Posting…' : 'Post to VantraRun'} icon="upload" busy={posting} disabled={!me} onPress={() => { void post(); }} />
          <Note>
            The post shows this run's distance, pace, time and zone{track.length >= 2 ? ', and the line of its route, including where it starts and ends' : ''}, to the audience above and no one else. Photo and video backgrounds are on the website for now.
          </Note>
        </>}
      </>}
  </Screen>;
}

const local = StyleSheet.create({
  picker: { marginHorizontal: -16, marginBottom: 14, flexGrow: 0 },
  pickerContent: { paddingHorizontal: 16, gap: 10 },
  runChip: { marginBottom: 0, paddingVertical: 12, paddingHorizontal: 14, gap: 4, maxWidth: 190, borderRadius: 16 },
  pressed: { opacity: 0.7 },
  gap: { height: 14 },
  audience: { gap: 10, marginTop: 10, marginBottom: 8 },
});

export default function ShareRunScreen() {
  return <Gated><ShareRunScreenBody /></Gated>;
}
