import React, { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { ActivityIndicator, Alert, FlatList, RefreshControl, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Action, Card, ErrorNotice, Heading, Label } from '../../src/components/Ui';
import { WEB_URL } from '../../src/config';
import { Brand, Gated } from '../../src/run/ui/Screen';
import { deletePost, loadDiscover, loadFeed } from '../../src/social/api';
import { postLink, postText, type Post } from '../../src/social/logic';
import { Pill, PostCard } from '../../src/social/ui/Parts';
import { useSocial, words } from '../../src/social/use-social';
import { colors } from '../../src/theme';
import { display, type } from '../../src/typography';

type Tab = 'feed' | 'discover';

// A post counts as on screen when most of it is; its video background plays only then.
const VIEWABILITY = { itemVisiblePercentThreshold: 60 };

/** The Feed tab, as the website's Feed page: "Your circle" is the runner's own posts and
 * their accepted friends' (the server's socialFeed picks them), "Discover" is posts made
 * public. Nothing is kept on the phone: with no connection the feed says so. */
function Feed() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { me, loadMe } = useSocial();
  const [tab, setTab] = useState<Tab>('feed');
  const [circle, setCircle] = useState<Post[] | null>(null);
  const [discover, setDiscover] = useState<Post[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const loadId = useRef(0);
  // Which posts are on screen, and whether this tab is the one showing: videos stop otherwise.
  const focused = useIsFocused();
  const [onScreen, setOnScreen] = useState<ReadonlySet<string>>(() => new Set());
  const onViewable = useRef(({ viewableItems }: { viewableItems: { key: string; isViewable: boolean }[] }) => {
    setOnScreen(new Set(viewableItems.flatMap((token) => (token.isViewable && typeof token.key === 'string' ? [token.key] : []))));
  }).current;

  const load = useCallback(async (which: Tab) => {
    const id = loadId.current + 1;
    loadId.current = id;
    try {
      // The profile is made on the first visit, as on the website, so posting and friends are ready.
      const { token } = await loadMe();
      const list = which === 'feed' ? await loadFeed(token) : await loadDiscover(token);
      if (id !== loadId.current) return;
      if (which === 'feed') setCircle(list); else setDiscover(list);
      setError(null);
      setNow(Date.now());
    } catch (cause) {
      if (id !== loadId.current) return;
      setError(words(cause));
    }
  }, [loadMe]);

  // Reloads whenever the tab is shown: a post just made in the composer is there.
  useFocusEffect(useCallback(() => { void load(tab); }, [load, tab]));

  async function refresh() {
    setRefreshing(true);
    await load(tab);
    setRefreshing(false);
  }

  async function remove(post: Post) {
    if (!me) return;
    setDeletingId(post.id);
    setError(null);
    try {
      await deletePost(me.token, post.id);
      loadId.current += 1; // a list still on its way would bring the post back
      setCircle((list) => (list ? list.filter((item) => item.id !== post.id) : list));
      setDiscover((list) => (list ? list.filter((item) => item.id !== post.id) : list));
    } catch (cause) {
      setError(`The post was not deleted. ${words(cause)}`);
    } finally {
      setDeletingId(null);
    }
  }

  function confirmDelete(post: Post) {
    Alert.alert('Delete this post?', 'It is removed from your feed and from everyone who could see it. The run itself is kept. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { void remove(post); } },
    ]);
  }

  function share(post: Post) {
    const link = postLink(WEB_URL, post.id);
    void Share.share({ message: link ? `${postText(post)}\n${link}` : postText(post) }).catch(() => {});
  }

  const compose = () => router.push('/share-run');
  const list = tab === 'feed' ? circle : discover;
  const shown = list ?? [];

  return <FlatList
    style={local.root}
    contentContainerStyle={[local.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}
    data={shown}
    keyExtractor={(item) => item.id}
    initialNumToRender={4}
    windowSize={5}
    viewabilityConfig={VIEWABILITY}
    onViewableItemsChanged={onViewable}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={colors.accent}
      colors={[colors.accentText]} progressBackgroundColor={colors.accent} />}
    ListHeaderComponent={<>
      <Brand />
      <View style={local.titleRow}>
        <View style={local.titleText}>
          <Label>Training circle</Label>
          <Text accessibilityRole="header" style={display(36)}>Feed</Text>
        </View>
        <View style={local.titleActions}>
          <Action label="Friends" icon="users" secondary compact onPress={() => router.push('/friends')} />
          <Action label="New post" icon="plus" compact onPress={compose} />
        </View>
      </View>
      <View style={local.tabs}>
        <Pill grow label="Your circle" selected={tab === 'feed'} onPress={() => setTab('feed')} />
        <Pill grow label="Discover" selected={tab === 'discover'} onPress={() => setTab('discover')} />
      </View>
      <ErrorNotice message={error} />
    </>}
    ListEmptyComponent={list === null && !error
      ? <View style={local.loading}><ActivityIndicator color={colors.accent} /><Text style={type.body}>Loading the feed…</Text></View>
      : error
        ? <>
          <Text style={[type.small, local.offline]}>The feed needs a connection. Nothing from it is kept on this phone.</Text>
          <Action label="Try again" secondary onPress={() => { void refresh(); }} busy={refreshing} />
        </>
        : <Card style={local.empty}>
          <Heading style={local.center}>{tab === 'feed' ? 'Nothing in your circle yet' : 'No public posts yet'}</Heading>
          <Text style={[type.body, local.center]}>{tab === 'feed'
            ? 'Post a run, then add friends so you can see each other’s sessions.'
            : 'When athletes share a run publicly, it shows up here.'}</Text>
          <Action label="Create a post" icon="plus" onPress={compose} />
        </Card>}
    ListFooterComponent={shown.length > 0 ? <Label style={local.footer}>Nothing posts unless you create it</Label> : undefined}
    renderItem={({ item }) => <PostCard post={item} now={now} mine={!!me && item.ownerId === me.account.id} busy={deletingId === item.id}
      visible={focused && onScreen.has(item.id)}
      onDelete={() => confirmDelete(item)} onShare={() => share(item)} />}
  />;
}

const local = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, paddingHorizontal: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16, paddingHorizontal: 4 },
  titleText: { flexShrink: 1, gap: 8 },
  titleActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  loading: { alignItems: 'center', gap: 12, paddingVertical: 48 },
  offline: { marginBottom: 4 },
  empty: { alignItems: 'stretch', paddingVertical: 28, gap: 12 },
  center: { textAlign: 'center' },
  footer: { textAlign: 'center', marginTop: 6 },
});

export default function FeedScreen() {
  return <Gated><Feed /></Gated>;
}
