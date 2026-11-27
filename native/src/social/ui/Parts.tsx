/** Pieces shared by the Feed, Friends and Challenges screens, built from the kit in
 * src/components/Ui.tsx: avatar circle, choice pills, a person row, the route trace, the
 * share card and the post card. Shapes follow the website's social components. */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Card, Heading, Icon, Label, Logo, type IconName } from '../../components/Ui';
import { API_URL } from '../../config';
import { formatDuration } from '../../run/format';
import { formatPace } from '../../run/zones';
import { brand, colors } from '../../theme';
import { display, fonts, stat, type } from '../../typography';
import { audienceIcon, audienceLabel, initials, timeAgo, traceSegments, type LatLng, type Post } from '../logic';
import { backgroundOf, cardDate } from '../media';
import { BackgroundMedia, type MediaSource } from './Media';

export function Avatar({ name, handle, size = 40, solid = false }: { name?: string | null; handle?: string | null; size?: number; solid?: boolean }) {
  return <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }, solid && styles.avatarSolid]}>
    <Text style={[styles.avatarText, solid && { color: colors.accentText }]}>{initials(name, handle)}</Text>
  </View>;
}

/** A pill that is one of several choices (audience, metric, month, feed tab). */
export function Pill({ label, icon, selected, onPress, disabled = false, grow = false }: {
  label: string;
  icon?: IconName;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  grow?: boolean;
}) {
  const tint = selected ? colors.accent : colors.muted;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} hitSlop={4}
    style={({ pressed }) => [styles.pill, grow && styles.grow, selected && styles.pillSelected, pressed && styles.pressed, disabled && styles.disabled]}>
    {!!icon && <Icon name={icon} size={14} color={tint} />}
    <Text style={[styles.pillText, { color: tint }]} numberOfLines={1}>{label}</Text>
  </Pressable>;
}

export function PillRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.pillRow}>{children}</View>;
}

/** Avatar, name and @handle, with whatever belongs on the right (a button, a status). */
export function PersonRow({ name, handle, detail, right, highlight = false }: {
  name: string;
  handle: string;
  detail?: string;
  right?: React.ReactNode;
  highlight?: boolean;
}) {
  return <View style={[styles.person, highlight && styles.personHighlight]}>
    <Avatar name={name} handle={handle} size={36} />
    <View style={styles.personText}>
      <Text style={type.bodyStrong} numberOfLines={1}>{name || handle}</Text>
      <Label>{`@${handle}${detail ? ` · ${detail}` : ''}`}</Label>
    </View>
    {right}
  </View>;
}

/** A small status word in an outline pill: "Pending", "Requested", "Friends". */
export function Tag({ label, icon, accent = false }: { label: string; icon?: IconName; accent?: boolean }) {
  const tint = accent ? colors.accent : colors.subtle;
  return <View style={styles.tag}>
    {!!icon && <Icon name={icon} size={12} color={tint} />}
    <Text style={[styles.tagText, { color: tint }]} numberOfLines={1}>{label}</Text>
  </View>;
}

const TRACE = 96;
const STROKE = 2.5;

/** The line of a run, drawn from the post's points with plain views: no map, no tiles, so
 * showing a post asks nothing of a map service. Start is the ringed dot. */
export function RouteTrace({ points, size = TRACE }: { points: LatLng[]; size?: number }) {
  const trace = useMemo(() => traceSegments(points, size, 6), [points, size]);
  if (!trace) return null;
  return <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
    {trace.segments.map((segment, index) => <View key={index} style={[styles.traceLine, {
      // Half a stroke longer at each end, so the rounded ends of neighbours overlap into a smooth joint.
      width: segment.length + STROKE,
      left: segment.cx - (segment.length + STROKE) / 2,
      top: segment.cy - STROKE / 2,
      transform: [{ rotate: `${segment.angle}deg` }],
    }]} />)}
    <View style={[styles.traceStart, { left: trace.start.x - 5, top: trace.start.y - 5 }]} />
  </View>;
}

/** Distance, pace, time, zone and the route line: the stats block of a post, also the
 * preview in the composer. */
export function RunStatsCard({ distanceMi, avgPaceSec, durationSec, zoneName, title, points }: {
  distanceMi: number;
  avgPaceSec: number;
  durationSec: number;
  zoneName: string;
  title: string;
  points: LatLng[];
}) {
  return <View style={styles.stats}>
    <View style={styles.statsTop}>
      <View style={styles.statsText}>
        <Label>Distance</Label>
        <View style={styles.baseline}>
          <Text style={stat(38)}>{(Number(distanceMi) || 0).toFixed(2)}</Text>
          <Label>mi</Label>
        </View>
        <View style={styles.statsLine}>
          <Text style={styles.statsSmall}>{formatPace(avgPaceSec)} /mi</Text>
          <Text style={styles.statsSmall}>{formatDuration(durationSec)}</Text>
          {!!zoneName && <Text style={[styles.statsSmall, { color: colors.accent }]}>{zoneName}</Text>}
        </View>
      </View>
      <RouteTrace points={points} />
    </View>
    {!!title && <View style={styles.statsTitle}><Label>{title}</Label></View>}
  </View>;
}

const CARD_W = 1080;
const CARD_H = 1350;

/** The website's share card (web/src/lib/shareCard.js), drawn with views instead of a canvas:
 * the photo or video, a flat Ink veil so the numbers stay readable, the logo and date, the
 * route line, the distance, then pace, time and zone, and the handle and title. Every size is
 * the website's, scaled from its 1080 x 1350 card to the width this one is given.
 * With no media, or media that will not load, the card is plain Ink. */
export function ShareCard({ media, playing = true, onMediaFailed, distanceMi, avgPaceSec, durationSec, zoneName, title, handle, date, points }: {
  media: MediaSource | null;
  /** A video plays only while this is true (the card is on screen). */
  playing?: boolean;
  onMediaFailed?: () => void;
  distanceMi: number;
  avgPaceSec: number;
  durationSec: number;
  zoneName: string;
  title: string;
  handle: string;
  /** "27 NOV 2026" */
  date: string;
  points: LatLng[];
}) {
  const [width, setWidth] = useState(0);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const shown = media && media.uri !== failedUri ? media : null;
  const s = width / CARD_W;
  const distance = (Number(distanceMi) || 0).toFixed(2);
  const columns: [string, string][] = [['Pace', formatPace(avgPaceSec)], ['Time', formatDuration(durationSec)], ['Zone', zoneName || '—']];
  const small = { fontFamily: fonts.bodyMedium, fontSize: 24 * s, lineHeight: 32 * s };
  return <View style={styles.shareCard} onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
    accessible accessibilityRole="image"
    accessibilityLabel={`${distance} miles. Pace ${formatPace(avgPaceSec)} per mile. Time ${formatDuration(durationSec)}.${zoneName ? ` ${zoneName}.` : ''}${title ? ` ${title}.` : ''}${shown ? ` Over a ${shown.kind}.` : ''}`}>
    {shown && <BackgroundMedia source={shown} playing={playing} onFailed={() => { setFailedUri(shown.uri); onMediaFailed?.(); }} />}
    {shown && <View style={styles.veil} pointerEvents="none" />}
    {width > 0 && <View style={[styles.shareBody, { paddingHorizontal: 72 * s, paddingTop: 62 * s, paddingBottom: 48 * s }]}>
      <View style={styles.shareRow}>
        <Logo variant="horizontal" height={52 * s} />
        <Text style={[small, { color: brand.text2 }]} numberOfLines={1}>{date}</Text>
      </View>
      <View style={styles.shareTrace}>
        <RouteTrace points={points} size={Math.round(480 * s)} />
      </View>
      <Text style={[small, { color: brand.steel, letterSpacing: 2 * s }]}>DISTANCE</Text>
      <View style={[styles.baseline, { gap: 24 * s }]}>
        <Text style={display(210 * s)} numberOfLines={1}>{distance}</Text>
        <Text style={[stat(56 * s), { color: brand.volt }]}>MI</Text>
      </View>
      <View style={[styles.shareRow, { marginTop: 44 * s }]}>
        {columns.map(([label, value]) => <View key={label} style={styles.shareColumn}>
          <Text style={[small, { fontSize: 22 * s, color: brand.steel, letterSpacing: 2 * s }]}>{label.toUpperCase()}</Text>
          <Text style={stat(52 * s)} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
        </View>)}
      </View>
      <View style={[styles.shareLine, { height: Math.max(StyleSheet.hairlineWidth, 2 * s), marginTop: 40 * s, marginBottom: 22 * s }]} />
      <View style={[styles.shareRow, { gap: 24 * s }]}>
        <Text style={[small, { color: brand.text2 }]} numberOfLines={1}>{handle ? `@${handle}` : ''}</Text>
        <Text style={[small, styles.shareTitle]} numberOfLines={1}>{title.slice(0, 34).toUpperCase()}</Text>
      </View>
    </View>}
  </View>;
}

export function PostCard({ post, mine, busy, onDelete, onShare, now, visible = true }: {
  post: Post;
  mine: boolean;
  busy: boolean;
  onDelete: () => void;
  onShare: () => void;
  now: number;
  /** On screen right now: a video background plays only then. */
  visible?: boolean;
}) {
  const name = post.authorName || post.authorHandle;
  // Only media on the VantraRun server is ever shown; anything else is a post without a background.
  const background = useMemo(() => backgroundOf(post, API_URL), [post.backgroundType, post.backgroundUrl]);
  const [mediaFailed, setMediaFailed] = useState(false);
  return <Card style={styles.post}>
    <View style={styles.postHeader}>
      <Avatar name={post.authorName} handle={post.authorHandle} size={36} />
      <View style={styles.personText}>
        <Heading size={15}>{name || 'Athlete'}</Heading>
        <Label>{`@${post.authorHandle} · ${timeAgo(post.createdAt, now)}`}</Label>
      </View>
      <Tag label={audienceLabel(post.visibility)} icon={audienceIcon(post.visibility)} />
    </View>
    {background.kind !== 'none' && !mediaFailed
      ? <ShareCard media={background} playing={visible} onMediaFailed={() => setMediaFailed(true)}
        distanceMi={post.distanceMi} avgPaceSec={post.avgPaceSec} durationSec={post.durationSec} zoneName={post.zoneName}
        title={post.title} handle={post.authorHandle} date={cardDate(post.createdAt)} points={post.routePoints} />
      : <RunStatsCard distanceMi={post.distanceMi} avgPaceSec={post.avgPaceSec} durationSec={post.durationSec} zoneName={post.zoneName}
        title={post.title} points={post.routePoints} />}
    {!!post.caption && <Text style={styles.caption}>{post.caption}</Text>}
    {mine && <View style={styles.postFooter}>
      <Pressable accessibilityRole="button" accessibilityLabel="Share this post" onPress={onShare} hitSlop={8}
        style={({ pressed }) => [styles.footerButton, pressed && styles.pressed]}>
        <Icon name="share-2" size={15} color={colors.muted} />
        <Text style={styles.footerText}>Share</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Delete post" accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={onDelete} hitSlop={8}
        style={({ pressed }) => [styles.footerButton, pressed && styles.pressed, busy && styles.disabled]}>
        <Icon name="trash-2" size={15} color={colors.muted} />
        <Text style={styles.footerText}>{busy ? 'Deleting…' : 'Delete'}</Text>
      </Pressable>
    </View>}
  </Card>;
}

const styles = StyleSheet.create({
  avatar: { backgroundColor: colors.selectedBg, alignItems: 'center', justifyContent: 'center' },
  avatarSolid: { backgroundColor: colors.accent },
  avatarText: { fontFamily: fonts.bodyStrong, fontSize: 12, color: colors.accent },
  pill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: 999,
    borderWidth: 1, borderColor: colors.panelBorder },
  pillSelected: { borderColor: colors.accent, backgroundColor: colors.selectedBg },
  pillText: { fontFamily: fonts.bodyMedium, fontSize: 13 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grow: { flex: 1 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1,
    borderColor: colors.panelBorder, backgroundColor: colors.background },
  personHighlight: { borderColor: colors.accent },
  personText: { flex: 1, gap: 2 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: colors.panelBorder, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  tagText: { fontFamily: fonts.bodyMedium, fontSize: 10, lineHeight: 14, textTransform: 'uppercase', letterSpacing: 1 },
  traceLine: { position: 'absolute', height: STROKE, borderRadius: STROKE / 2, backgroundColor: brand.volt },
  traceStart: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: brand.ink, borderWidth: 2, borderColor: brand.volt },
  stats: { borderWidth: 1, borderColor: colors.panelBorder, borderRadius: 16, backgroundColor: colors.background, overflow: 'hidden' },
  statsTop: { flexDirection: 'row', alignItems: 'stretch', gap: 14, padding: 14 },
  statsText: { flex: 1, gap: 6 },
  baseline: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  statsLine: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4, marginTop: 4 },
  statsSmall: { ...type.small, color: colors.muted, fontVariant: ['tabular-nums'] },
  statsTitle: { borderTopWidth: 1, borderTopColor: colors.panelBorder, paddingHorizontal: 14, paddingVertical: 8 },
  shareCard: { width: '100%', aspectRatio: CARD_W / CARD_H, borderRadius: 16, overflow: 'hidden', backgroundColor: brand.ink, borderWidth: 1, borderColor: colors.panelBorder },
  veil: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(11, 11, 12, 0.72)' },
  shareBody: { flex: 1 },
  shareRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  shareTrace: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  shareColumn: { flex: 1 },
  shareLine: { backgroundColor: brand.line },
  shareTitle: { flexShrink: 1, textAlign: 'right', color: brand.volt },
  post: { gap: 12 },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  caption: { ...type.body, color: colors.text },
  postFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  footerButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 4 },
  footerText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.muted },
});
