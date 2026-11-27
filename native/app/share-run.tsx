import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Action, Card, ErrorNotice, Field, Heading, Label, Notice, SectionHeading } from '../src/components/Ui';
import { API_URL, WEB_URL } from '../src/config';
import { listRunsToShare } from '../src/run/api';
import { Brand, Gated, Loading, Note, Screen } from '../src/run/ui/Screen';
import { useRunAccount } from '../src/run/use-run';
import { createPost, uploadMedia } from '../src/social/api';
import { AUDIENCES, buildPost, defaultAudience, postLink, postText, thinTrack, type Audience, type Post, type ShareRun } from '../src/social/logic';
import { NO_BACKGROUND, STOCK_BACKGROUNDS, backgroundOf, cardDate, mediaUrl, stockBackground, uploadedBackground, type Background, type PickedMedia } from '../src/social/media';
import { canTakePhoto, chooseFromLibrary, takePhoto, type PickResult } from '../src/social/media-picker';
import type { MediaSource } from '../src/social/ui/Media';
import { Pill, PillRow, RunStatsCard, ShareCard, Tag } from '../src/social/ui/Parts';
import { sendFile } from '../src/social/upload-file';
import { useSocial, words } from '../src/social/use-social';
import { colors } from '../src/theme';
import { type } from '../src/typography';

type Run = ShareRun & { externalId: string | null; startedAt: string | null };

/** What is behind the stats: nothing, one of the website's three photos, or a file from this phone. */
type Choice = { kind: 'none' } | { kind: 'stock'; id: string } | { kind: 'picked'; media: PickedMedia };

const AUDIENCE_NOTE: Record<Audience, string> = {
  public: 'Anyone on VantraRun can see this post.',
  friends: 'Only your accepted friends can see this post.',
  private: 'Only you can see this post.',
};

const megabytes = (bytes: number | null) => (bytes === null ? '' : ` · ${bytes < 1024 * 1024 ? '<1' : Math.round(bytes / (1024 * 1024))} MB`);

/** The website's New post composer: pick a run, choose what is behind the stats (nothing, a
 * stock photo, or a photo or video of your own), add a caption, choose who sees it, post.
 * A photo or video stays on the phone until Post is tapped; only then is it uploaded, and
 * the post names the address the server stored it at. Opened with `run` (the server's id of
 * a run) or `ext` (the id the phone gave a run it recorded) to start on that run. */
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
  const [choice, setChoice] = useState<Choice>({ kind: 'none' });
  const [picking, setPicking] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  // Null while nothing is being sent; 0–100 while the photo or video is on its way.
  const [uploading, setUploading] = useState<number | null>(null);
  const [created, setCreated] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A file the server already has, so trying the post again does not send it twice.
  const stored = useRef<{ uri: string; background: Background } | null>(null);
  const cancel = useRef<AbortController | null>(null);

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
  // Leaving the composer stops an upload that is still going.
  useEffect(() => () => { cancel.current?.abort(); }, []);

  const selected = useMemo(() => (runs ?? []).find((run) => run.id === selectedId) ?? null, [runs, selectedId]);
  const track = useMemo(() => thinTrack(selected?.points), [selected]);
  const audience: Audience = picked ?? defaultAudience(me?.profile);

  // The preview shows the file on the phone; a stock photo comes from the VantraRun server.
  const preview = useMemo((): MediaSource | null => {
    if (choice.kind === 'picked') return { kind: choice.media.kind, uri: choice.media.uri };
    if (choice.kind === 'stock') {
      const uri = mediaUrl(API_URL, stockBackground(choice.id).url);
      return uri ? { kind: 'photo', uri } : null;
    }
    return null;
  }, [choice]);

  async function pick(open: () => Promise<PickResult>) {
    if (picking || posting) return;
    setPicking(true);
    setMediaError(null);
    try {
      const result = await open();
      if (result.status === 'picked') setChoice({ kind: 'picked', media: result.media });
      if (result.status === 'refused') setMediaError(result.error);
    } finally {
      setPicking(false);
    }
  }

  function choose(next: Choice) {
    setMediaError(null);
    setChoice(next);
  }

  async function post() {
    if (!me || !selected || posting || created) return;
    setPosting(true);
    setError(null);
    try {
      let background = NO_BACKGROUND;
      if (choice.kind === 'stock') background = stockBackground(choice.id);
      if (choice.kind === 'picked') {
        const { media } = choice;
        if (stored.current?.uri !== media.uri) {
          const controller = new AbortController();
          cancel.current = controller;
          setUploading(0);
          const fileUrl = await uploadMedia(me.token, media, sendFile, { onProgress: setUploading, signal: controller.signal });
          stored.current = { uri: media.uri, background: uploadedBackground(media.kind, fileUrl) };
        }
        background = stored.current.background;
        setUploading(null);
      }
      setCreated(await createPost(me.token, buildPost({ run: selected, caption, audience, profile: me.profile, background })));
    } catch (cause) {
      // The caption, the run, the audience and the chosen file all stay as they are.
      setError(`The run was not posted. ${words(cause)}`);
    } finally {
      cancel.current = null;
      setUploading(null);
      setPosting(false);
    }
  }

  function shareOut(made: Post) {
    const link = postLink(WEB_URL, made.id);
    void Share.share({ message: link ? `${postText(made)}\n${link}` : postText(made) }).catch(() => {});
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace('/feed'));

  if (runs === null || (!me && !error)) return <Loading label="Loading your runs…" />;

  const madeBackground = created ? backgroundOf(created, API_URL) : null;

  return <Screen>
    <Brand onBack={back} nav={false} />
    <SectionHeading kicker="Share a run" title="New post" subtitle="Nothing is ever posted automatically. Every run you share is one you pick." />
    <ErrorNotice message={error} />
    {!!error && !created && !selected && <Action label="Try again" secondary onPress={() => { void load(); }} />}

    {created
      ? <>
        <Notice icon="check">Posted. {AUDIENCE_NOTE[created.visibility as Audience] ?? ''}</Notice>
        {madeBackground && madeBackground.kind !== 'none'
          ? <View style={local.card}>
            <ShareCard media={madeBackground} distanceMi={created.distanceMi} avgPaceSec={created.avgPaceSec} durationSec={created.durationSec}
              zoneName={created.zoneName} title={created.title} handle={created.authorHandle} date={cardDate(created.createdAt)} points={created.routePoints} />
          </View>
          : <RunStatsCard distanceMi={created.distanceMi} avgPaceSec={created.avgPaceSec} durationSec={created.durationSec} zoneName={created.zoneName}
            title={created.title} points={created.routePoints} />}
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
            return <Pressable key={run.id} accessibilityRole="button" accessibilityState={{ selected: on, disabled: posting }} disabled={posting} onPress={() => setSelectedId(run.id)}
              style={({ pressed }) => pressed && local.pressed}>
              <Card selected={on} style={local.runChip}>
                <Text style={[type.bodyStrong, on && { color: colors.accent }]} numberOfLines={1}>{run.routeName || 'Free run'}</Text>
                <Label>{`${run.distanceMi.toFixed(2)} mi${run.startedAt ? ` · ${new Date(run.startedAt).toLocaleDateString()}` : ''}`}</Label>
              </Card>
            </Pressable>;
          })}
        </ScrollView>}

        {selected && <>
          <View style={local.card}>
            <ShareCard media={preview} onMediaFailed={() => setMediaError(choice.kind === 'stock'
              ? 'That background could not be loaded. Check your connection, or post without it.'
              : 'That file could not be shown on this phone. It may still post, but pick another one to be sure.')}
              distanceMi={selected.distanceMi} avgPaceSec={selected.avgPaceSec} durationSec={selected.durationSec}
              zoneName={selected.targetZoneName ?? ''} title={selected.routeName || 'Free run'} handle={me?.profile.handle ?? ''}
              date={cardDate(selected.startedAt ?? new Date().toISOString())} points={track} />
          </View>

          <Heading size={16}>Background</Heading>
          <View style={local.group}>
            <PillRow>
              <Pill label="None" selected={choice.kind === 'none'} disabled={posting} onPress={() => choose({ kind: 'none' })} />
              {STOCK_BACKGROUNDS.map((stock) => <Pill key={stock.id} label={stock.label} selected={choice.kind === 'stock' && choice.id === stock.id}
                disabled={posting} onPress={() => choose({ kind: 'stock', id: stock.id })} />)}
            </PillRow>
            <PillRow>
              <Pill label="Choose a photo or video" icon="image" selected={false} disabled={posting || picking} onPress={() => { void pick(chooseFromLibrary); }} />
              {canTakePhoto && <Pill label="Take a photo" icon="camera" selected={false} disabled={posting || picking} onPress={() => { void pick(takePhoto); }} />}
            </PillRow>
            {choice.kind === 'picked' && <View style={local.chosen}>
              <Tag accent icon={choice.media.kind === 'video' ? 'video' : 'image'} label={`Your ${choice.media.kind}${megabytes(choice.media.sizeBytes)}`} />
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove your ${choice.media.kind}`} accessibilityState={{ disabled: posting }} disabled={posting}
                onPress={() => choose({ kind: 'none' })} hitSlop={8} style={({ pressed }) => [local.remove, pressed && local.pressed, posting && local.dim]}>
                <Text style={local.removeText}>Remove</Text>
              </Pressable>
            </View>}
            <ErrorNotice message={mediaError} />
            <Text style={type.small}>
              Your photo or video stays on this phone until you tap Post. It is then stored on VantraRun publicly: anyone who has its link can open it, whoever the post is for. Details saved inside the file, such as where it was taken, are not removed. A video plays without sound.
            </Text>
          </View>

          <Field label="Caption" value={caption} onChangeText={setCaption} placeholder="Legs felt heavy, kept it easy." autoCapitalize="sentences" multiline maxLength={500} />

          <Heading size={16}>Who sees it</Heading>
          <View style={local.group}>
            <PillRow>
              {AUDIENCES.map((option) => <Pill key={option.id} label={option.label} icon={option.icon} selected={audience === option.id}
                disabled={posting} onPress={() => setPicked(option.id)} />)}
            </PillRow>
            <Text style={type.small}>{AUDIENCE_NOTE[audience]}</Text>
          </View>

          <Action label={uploading !== null ? `Uploading your ${choice.kind === 'picked' ? choice.media.kind : 'file'}… ${uploading}%` : posting ? 'Posting…' : 'Post to VantraRun'}
            icon="upload" busy={posting} disabled={!me || picking} onPress={() => { void post(); }} />
          {uploading !== null && <Action label="Cancel the upload" variant="ghost" onPress={() => cancel.current?.abort()} />}
          <Note>
            The post shows this run's distance, pace, time and zone{track.length >= 2 ? ', and the line of its route, including where it starts and ends' : ''}{choice.kind === 'none' ? '' : ', over the background you chose'}, to the audience above and no one else.
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
  dim: { opacity: 0.5 },
  card: { alignSelf: 'center', width: '100%', maxWidth: 300, marginBottom: 18 },
  group: { gap: 10, marginTop: 10, marginBottom: 18 },
  chosen: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  remove: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 4 },
  removeText: { fontFamily: type.bodyMedium.fontFamily, fontSize: 13, color: colors.muted, textDecorationLine: 'underline' },
});

export default function ShareRunScreen() {
  return <Gated><ShareRunScreenBody /></Gated>;
}
