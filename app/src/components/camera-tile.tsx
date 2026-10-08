import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import type { ServerApi } from '@/lib/api';
import type { Camera } from '@/lib/types';
import { fonts, radius, useColors } from '@/theme';

import { MotionPulse, StatusChips, useMotionActive } from './camera-badges';
import { HlsVideo } from './hls-video';
import { Icon } from './icon';
import { LiveSnapshot } from './live-snapshot';
import { PressableScale } from './pressable-scale';

type Props = {
  camera: Camera;
  api: ServerApi;
  width: number;
  video: boolean;
  visible: boolean;
  compact?: boolean;
  onPress: () => void;
  onLongPress: () => void;
};

export const CameraTile = memo(function CameraTile({ camera, api, width, video, visible, compact, onPress, onLongPress }: Props) {
  const c = useColors();
  const motion = useMotionActive(camera.id);
  const [videoReady, setVideoReady] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const online = camera.status.online && camera.enabled;
  const playVideo = video && visible && online && !videoFailed;
  const snapshotWidth = Math.min(1280, Math.round(width * 2));
  const height = Math.round((width * 9) / 16);

  return (
    <PressableScale
      scaleTo={0.975}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={camera.name}
      accessibilityHint={camera.status.online ? undefined : 'offline'}
      style={[styles.tile, { width, height, backgroundColor: c.tile }]}>
      {online ? (
        <LiveSnapshot
          uri={api.snapshotUrl(camera.id, snapshotWidth)}
          intervalMs={playVideo && videoReady ? 0 : visible ? 3000 : 0}
          active={visible}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.offline]}>
          <Icon name="offline" size={compact ? 18 : 24} color="rgba(255,255,255,0.35)" />
        </View>
      )}
      {playVideo ? (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: videoReady ? 1 : 0 }]} pointerEvents="none">
          <HlsVideo
            uri={api.liveHlsUrl(camera.id, 'sd')}
            muted
            style={StyleSheet.absoluteFill}
            onFirstFrame={() => setVideoReady(true)}
            onError={() => {
              setVideoFailed(true);
              setVideoReady(false);
            }}
          />
        </Animated.View>
      ) : null}
      <Svg style={styles.shade} pointerEvents="none">
        <Defs>
          <LinearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#000" stopOpacity="0" />
            <Stop offset="1" stopColor="#000" stopOpacity="0.72" />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#shade)" />
      </Svg>
      <View style={styles.top} pointerEvents="none">
        <StatusChips camera={camera} motion={motion} compact={compact} />
      </View>
      <Animated.View entering={FadeIn} style={styles.bottom} pointerEvents="none">
        <Text style={[styles.name, compact && { fontSize: 12 }]} numberOfLines={1}>
          {camera.name}
        </Text>
        {camera.capabilities.audio && !compact ? <Icon name="speaker" size={11} color="rgba(255,255,255,0.7)" /> : null}
      </Animated.View>
      <MotionPulse active={motion && online} />
    </PressableScale>
  );
});

export function AddTile({ width, label, onPress }: { width: number; label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.tile, styles.add, { width, height: Math.round((width * 9) / 16), borderColor: c.borderStrong, backgroundColor: pressed ? c.surfacePressed : 'transparent' }]}>
      <Icon name="plus" size={20} color={c.textSecondary} />
      <Text style={{ color: c.textSecondary, fontFamily: fonts.medium, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { borderRadius: radius.md, overflow: 'hidden' },
  offline: { alignItems: 'center', justifyContent: 'center' },
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' },
  top: { position: 'absolute', top: 8, left: 8, right: 8, flexDirection: 'row' },
  bottom: { position: 'absolute', left: 10, right: 10, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flex: 1, color: '#fff', fontFamily: fonts.semibold, fontSize: 13.5, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 },
  add: { borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 6 },
});
