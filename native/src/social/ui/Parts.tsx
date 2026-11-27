/** Pieces shared by the Feed, Friends and Challenges screens, built from the kit in
 * src/components/Ui.tsx: avatar circle, choice pills, a person row, the route trace and
 * the post card. Shapes follow the website's social components. */
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, Heading, Icon, Label, type IconName } from '../../components/Ui';
import { formatDuration } from '../../run/format';
import { formatPace } from '../../run/zones';
import { brand, colors } from '../../theme';
import { fonts, stat, type } from '../../typography';
import { audienceIcon, audienceLabel, initials, timeAgo, traceSegments, type LatLng, type Post } from '../logic';

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

export function PostCard({ post, mine, busy, onDelete, onShare, now }: {
  post: Post;
  mine: boolean;
  busy: boolean;
  onDelete: () => void;
  onShare: () => void;
  now: number;
}) {
  const name = post.authorName || post.authorHandle;
  return <Card style={styles.post}>
    <View style={styles.postHeader}>
      <Avatar name={post.authorName} handle={post.authorHandle} size={36} />
      <View style={styles.personText}>
        <Heading size={15}>{name || 'Athlete'}</Heading>
        <Label>{`@${post.authorHandle} · ${timeAgo(post.createdAt, now)}`}</Label>
      </View>
      <Tag label={audienceLabel(post.visibility)} icon={audienceIcon(post.visibility)} />
    </View>
    <RunStatsCard distanceMi={post.distanceMi} avgPaceSec={post.avgPaceSec} durationSec={post.durationSec} zoneName={post.zoneName}
      title={post.title} points={post.routePoints} />
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
  post: { gap: 12 },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  caption: { ...type.body, color: colors.text },
  postFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  footerButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 4 },
  footerText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.muted },
});
