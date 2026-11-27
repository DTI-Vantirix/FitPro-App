/** The photo or video behind a post's stats. The one place the app plays video.
 * A video is muted, loops, has no controls, and exists only while `playing`: a card that
 * is off screen holds no player at all. It never takes the phone's audio from music or the
 * run coach. If the media cannot be loaded, `onFailed` is called once and the card falls
 * back to its plain form. */
import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useEventListener } from 'expo';
import { VideoView, useVideoPlayer } from 'expo-video';
import { brand } from '../../theme';

export type MediaSource = { kind: 'photo' | 'video'; uri: string };

function VideoBackground({ uri, onFailed }: { uri: string; onFailed: () => void }) {
  const player = useVideoPlayer(uri, (created) => {
    created.loop = true;
    created.muted = true;
    created.audioMixingMode = 'mixWithOthers';
    created.play();
  });
  useEventListener(player, 'statusChange', ({ status }) => { if (status === 'error') onFailed(); });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false}
    allowsPictureInPicture={false} fullscreenOptions={{ enable: false }} />;
}

export function BackgroundMedia({ source, playing, onFailed }: { source: MediaSource; playing: boolean; onFailed: () => void }) {
  return <View style={styles.fill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    {source.kind === 'photo'
      ? <Image source={{ uri: source.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={onFailed} />
      : playing ? <VideoBackground key={source.uri} uri={source.uri} onFailed={onFailed} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: brand.ink },
});
