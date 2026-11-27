import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Share, StyleSheet, Text, View } from 'react-native';
import { Action, Card, ErrorNotice, Field, Heading, IconButton, Label, Notice, SectionHeading, type IconName } from '../src/components/Ui';
import { WEB_URL } from '../src/config';
import { Brand, Gated, Loading, Screen } from '../src/run/ui/Screen';
import { acceptConnection, findProfileByHandle, listProfiles, loadConnections, removeConnection, sendRequest } from '../src/social/api';
import { forgetInvite, handledInvites, inviteHandle, inviteMessage, inviteStep, markInviteHandled } from '../src/social/invite-link';
import { cleanHandle, connectionWith, inviteLink, otherSide, searchProfiles, splitConnections, type Connection, type SocialProfile } from '../src/social/logic';
import { Avatar, PersonRow, Tag } from '../src/social/ui/Parts';
import { useSocial, words } from '../src/social/use-social';
import { colors } from '../src/theme';
import { type } from '../src/typography';

/** The website's Friends page: your profile and invite link, search by handle or name,
 * requests waiting for you, your friends, and the requests you sent.
 *
 * Opened by an invite link (/friends?add=<handle>, see src/social/invite-link.ts) it also does
 * what the website does with one: looks the handle up and sends that person a friend request,
 * once, saying who it is for and what came of it. */
function Friends() {
  const router = useRouter();
  // Cleaned here, before anything else sees it: a link can be written by anyone.
  const linked = inviteHandle(useLocalSearchParams<{ add?: string | string[] }>().add);
  const [linkNews, setLinkNews] = useState<{ text: string; icon: IconName } | null>(null);
  const { me, loadMe } = useSocial();
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [people, setPeople] = useState<SocialProfile[]>([]);
  const [exact, setExact] = useState<SocialProfile | null>(null);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const loadId = useRef(0);

  const load = useCallback(async () => {
    const id = loadId.current + 1;
    loadId.current = id;
    try {
      const { token, account } = await loadMe();
      const [links, directory] = await Promise.all([loadConnections(token, account.id), listProfiles(token).catch(() => [] as SocialProfile[])]);
      if (id !== loadId.current) return;
      setConnections(links);
      setPeople(directory);
      setError(null);
    } catch (cause) {
      if (id !== loadId.current) return;
      setError(words(cause));
    }
  }, [loadMe]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // The directory holds the first 100 profiles; a full handle typed in is also looked up by itself.
  const meId = me?.account.id ?? '';
  const token = me?.token ?? null;
  const needle = query.trim();
  useEffect(() => {
    const handle = cleanHandle(needle.replace(/^@/, ''));
    setExact(null);
    if (!token || handle.length < 2 || people.some((p) => p.handle === handle)) return;
    let live = true;
    const timer = setTimeout(() => {
      findProfileByHandle(token, handle).then((found) => { if (live) setExact(found); }).catch(() => {});
    }, 400);
    return () => { live = false; clearTimeout(timer); };
  }, [needle, token, people]);

  // The link has arrived where it was going, so the access gate has nothing left to carry.
  useEffect(() => { forgetInvite(); }, [linked]);

  // An invite link: one lookup and at most one request, to somebody else, however often this
  // screen is drawn or the same link is opened. inviteStep decides; this only carries it out.
  useEffect(() => {
    if (!me) return;
    const who = { id: me.account.id, handle: me.profile.handle };
    const first = inviteStep({ add: linked, me: who, connections, handled: handledInvites() });
    if (first.kind === 'self') { setLinkNews({ text: inviteMessage(first), icon: 'info' }); return; }
    // Dealt with already: the person is left in the search box, where their state shows.
    if (first.kind === 'done') { setQuery((typed) => typed || `@${linked}`); return; }
    if (first.kind !== 'lookup') return;
    // Marked before anything is awaited, so nothing that happens meanwhile can start a second one.
    markInviteHandled(who.id, first.handle);
    const known = connections ?? [];
    setQuery(`@${first.handle}`);
    setLinkNews({ text: inviteMessage({ kind: 'looking', handle: first.handle }), icon: 'user-plus' });
    void (async () => {
      try {
        const found = await findProfileByHandle(me.token, first.handle);
        const next = inviteStep({ add: first.handle, me: who, connections: known, handled: [], found });
        if (next.kind === 'send') {
          setLinkNews({ text: inviteMessage({ kind: 'sending', target: next.target }), icon: 'user-plus' });
          const made = await sendRequest(me.token, { meId: who.id, myProfile: me.profile, target: next.target });
          setLinkNews({ text: inviteMessage({ kind: 'sent', target: next.target, status: made.status }), icon: 'check' });
          await load();
        } else if (next.kind === 'missing' || next.kind === 'already' || next.kind === 'self') {
          setLinkNews({ text: inviteMessage(next, who.id), icon: 'info' });
        }
      } catch (cause) {
        setLinkNews(null);
        setError(`The friend request to @${first.handle} was not sent. ${words(cause)} Their handle is in the search box: tap Connect to try again.`);
      }
    })();
  }, [linked, me, connections, load]);

  const results = useMemo(() => {
    const found = searchProfiles(people, needle, meId);
    return exact && exact.ownerId !== meId && !found.some((p) => p.id === exact.id) ? [exact, ...found] : found;
  }, [people, needle, meId, exact]);

  /** One change at a time; the lists are read again afterwards whatever happened. */
  async function act(id: string, failed: string, work: (token: string) => Promise<string | null>) {
    if (!me || busyId) return;
    setBusyId(id);
    setError(null);
    setNote(null);
    try {
      const said = await work(me.token);
      if (said) setNote(said);
    } catch (cause) {
      setError(`${failed} ${words(cause)}`);
    }
    await load();
    setBusyId(null);
  }

  const connect = (target: SocialProfile) => act(target.id, 'The request was not sent.', async (tok) => {
    if (!me) return null;
    const made = await sendRequest(tok, { meId: me.account.id, myProfile: me.profile, target });
    return made.status === 'accepted' ? `You're connected with @${target.handle}.` : `Request sent to @${target.handle}.`;
  });
  const accept = (c: Connection) => act(c.id, 'The request was not accepted.', async (tok) => { await acceptConnection(tok, c.id); return `You're connected with @${otherSide(c, meId).handle}.`; });
  const drop = (c: Connection, failed: string) => act(c.id, failed, async (tok) => { await removeConnection(tok, c.id); return null; });

  function confirmRemove(c: Connection) {
    const who = otherSide(c, meId);
    Alert.alert(`Remove ${who.name}?`, `You and @${who.handle} stop seeing each other's friends-only posts. Either of you can send a new request later.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { void drop(c, 'The friend was not removed.'); } },
    ]);
  }

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace('/feed'));

  if (!me && !error) return <Loading label="Loading your friends…" />;

  const split = splitConnections(connections ?? [], meId);
  const link = me ? inviteLink(WEB_URL, me.profile.handle) : '';

  return <Screen onRefresh={() => { void refresh(); }} refreshing={refreshing}>
    <Brand onBack={back} />
    <SectionHeading kicker="Your circle" title="Friends"
      subtitle="Find athletes by handle inside VantraRun. Facebook and Instagram don’t hand over a friend list, so the invite link is how you bring people over from there." />
    <ErrorNotice message={error} />
    {!!linkNews && <Notice icon={linkNews.icon}>{linkNews.text}</Notice>}
    {!!note && <Notice icon="check">{note}</Notice>}
    {!me && <Action label="Try again" secondary onPress={() => { void refresh(); }} busy={refreshing} />}

    {me && <>
      <Card>
        <View style={local.profile}>
          <Avatar name={me.profile.displayName} handle={me.profile.handle} size={44} />
          <View style={local.profileText}>
            <Heading size={16}>{me.profile.displayName || me.profile.handle}</Heading>
            <Label>{`@${me.profile.handle} · ${me.profile.visibility} account`}</Label>
          </View>
          <Action label="Edit" variant="ghost" compact onPress={() => router.push('/social-profile')} />
        </View>
        {!!link && <>
          <View style={local.linkBox}>
            <Label>Invite link</Label>
            <Text style={type.small} selectable numberOfLines={2}>{link}</Text>
          </View>
          <Action label="Share invite link" icon="share-2" compact
            onPress={() => { void Share.share({ message: `Run with me on VantraRun\n${link}` }).catch(() => {}); }} />
          <Text style={type.small}>The link opens VantraRun: the app on a phone that has it, the website otherwise. Whoever opens it signed in sends you a friend request.</Text>
        </>}
      </Card>

      <Card>
        <Field label="Search by @handle or name" value={query} onChangeText={setQuery} placeholder="@handle" />
        {!!needle && results.length === 0 && <Text style={type.small}>Nobody matches “{needle}”. Invite them with your invite link instead.</Text>}
        {!!needle && <View style={local.rows}>
          {results.map((person) => {
            const existing = connectionWith(connections ?? [], meId, person.ownerId);
            return <PersonRow key={person.id} name={person.displayName} handle={person.handle} detail={person.visibility}
              right={existing
                ? <Tag label={existing.status === 'accepted' ? 'Friends' : 'Requested'} accent={existing.status === 'accepted'} />
                : <Action label="Connect" icon="user-plus" compact busy={busyId === person.id} disabled={!!busyId} onPress={() => { void connect(person); }} />} />;
          })}
        </View>}
      </Card>

      {split.incoming.length > 0 && <Card>
        <Heading>Requests</Heading>
        <View style={local.rows}>
          {split.incoming.map((c) => {
            const who = otherSide(c, meId);
            return <PersonRow key={c.id} name={who.name} handle={who.handle} highlight right={<View style={local.buttons}>
              <IconButton icon="check" label={`Accept ${who.name}`} active onPress={() => { void accept(c); }} />
              <IconButton icon="x" label={`Decline ${who.name}`} onPress={() => { void drop(c, 'The request was not declined.'); }} />
            </View>} />;
          })}
        </View>
      </Card>}

      <Card>
        <Heading>Your friends ({split.friends.length})</Heading>
        {connections === null
          ? <Text style={type.small}>Your friends could not be loaded. Pull down to try again.</Text>
          : split.friends.length === 0
            ? <Text style={type.small}>No friends yet — search a handle or send an invite link.</Text>
            : <View style={local.rows}>
              {split.friends.map((c) => {
                const who = otherSide(c, meId);
                return <PersonRow key={c.id} name={who.name} handle={who.handle}
                  right={<IconButton icon="user-x" label={`Remove ${who.name}`} onPress={() => confirmRemove(c)} />} />;
              })}
            </View>}
      </Card>

      {split.outgoing.length > 0 && <Card>
        <Heading>Sent requests</Heading>
        <View style={local.rows}>
          {split.outgoing.map((c) => {
            const who = otherSide(c, meId);
            return <PersonRow key={c.id} name={who.name} handle={who.handle} right={<View style={local.buttons}>
              <Tag label="Pending" icon="clock" />
              <IconButton icon="x" label={`Cancel the request to ${who.name}`} onPress={() => { void drop(c, 'The request was not cancelled.'); }} />
            </View>} />;
          })}
        </View>
      </Card>}
    </>}
  </Screen>;
}

const local = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  profileText: { flex: 1, gap: 2 },
  linkBox: { borderWidth: 1, borderColor: colors.panelBorder, borderRadius: 14, padding: 12, gap: 4 },
  rows: { gap: 8 },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});

export default function FriendsScreen() {
  return <Gated><Friends /></Gated>;
}
