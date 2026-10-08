import * as Haptics from 'expo-haptics';
import { useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { useT } from '@/i18n';
import type { ServerApi } from '@/lib/api';
import type { Camera } from '@/lib/types';
import { fonts, onVideo, radius, space } from '@/theme';

import { Icon } from './icon';

const SIZE = 148;
const KNOB = 56;
const R = (SIZE - KNOB) / 2;

export function PtzPad({ api, camera }: { api: ServerApi; camera: Camera }) {
  const { t } = useT();
  const kx = useSharedValue(0);
  const ky = useSharedValue(0);
  const last = useRef({ pan: 0, tilt: 0, at: 0 });
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = (pan: number, tilt: number) => {
    const now = Date.now();
    const p = Math.round(pan * 10) / 10;
    const tl = Math.round(tilt * 10) / 10;
    if (p === last.current.pan && tl === last.current.tilt) return;
    const fire = () => {
      last.current = { pan: p, tilt: tl, at: Date.now() };
      api.ptz(camera.id, { action: 'move', pan: p, tilt: tl, zoom: 0 }).catch(() => undefined);
    };
    if (pending.current) clearTimeout(pending.current);
    const wait = Math.max(0, 200 - (now - last.current.at));
    pending.current = setTimeout(fire, wait);
  };

  const stop = () => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
    last.current = { pan: 0, tilt: 0, at: Date.now() };
    api.ptz(camera.id, { action: 'stop' }).catch(() => undefined);
  };

  const start = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);

  const pan = Gesture.Pan()
    .onBegin(() => {
      runOnJS(start)();
    })
    .onUpdate((e) => {
      const d = Math.hypot(e.translationX, e.translationY);
      const f = d > R ? R / d : 1;
      kx.value = e.translationX * f;
      ky.value = e.translationY * f;
      runOnJS(send)(kx.value / R, -ky.value / R);
    })
    .onFinalize(() => {
      kx.value = withSpring(0, { damping: 15, stiffness: 220 });
      ky.value = withSpring(0, { damping: 15, stiffness: 220 });
      runOnJS(stop)();
    });

  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: kx.value }, { translateY: ky.value }] }));

  const zoom = (dir: number) => {
    start();
    api.ptz(camera.id, { action: 'move', pan: 0, tilt: 0, zoom: dir * 0.6 }).catch(() => undefined);
  };

  const presets = camera.capabilities.ptzPresets ?? [];

  return (
    <View style={styles.root}>
      <View style={styles.row}>
        <GestureDetector gesture={pan}>
          <View style={styles.pad} accessibilityLabel={t('live.ptz')}>
            <Icon name="chevronUp" size={14} color={onVideo.textSecondary} style={[styles.arrow, { top: 8 }]} />
            <Icon name="chevronDown" size={14} color={onVideo.textSecondary} style={[styles.arrow, { bottom: 8 }]} />
            <Icon name="chevronLeft" size={14} color={onVideo.textSecondary} style={[styles.arrowH, { left: 8 }]} />
            <Icon name="chevronRight" size={14} color={onVideo.textSecondary} style={[styles.arrowH, { right: 8 }]} />
            <Animated.View style={[styles.knob, knob]} />
          </View>
        </GestureDetector>
        <View style={styles.zoom}>
          <Pressable onPressIn={() => zoom(1)} onPressOut={stop} style={styles.zoomBtn} accessibilityLabel={t('live.zoomIn')}>
            <Icon name="plus" size={18} color="#fff" />
          </Pressable>
          <View style={styles.zoomDivider} />
          <Pressable onPressIn={() => zoom(-1)} onPressOut={stop} style={styles.zoomBtn} accessibilityLabel={t('live.zoomOut')}>
            <Icon name="minus" size={18} color="#fff" />
          </Pressable>
        </View>
      </View>
      {presets.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presets}>
          {presets.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => {
                start();
                api.ptz(camera.id, { action: 'preset', preset: p.id }).catch(() => undefined);
              }}
              style={({ pressed }) => [styles.preset, pressed && { backgroundColor: 'rgba(255,255,255,0.22)' }]}>
              <Icon name="star" size={11} color="#2DD4BF" />
              <Text style={styles.presetText} numberOfLines={1}>
                {p.name || p.id}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.md, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xl },
  pad: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, backgroundColor: onVideo.glass, borderWidth: StyleSheet.hairlineWidth, borderColor: onVideo.border, alignItems: 'center', justifyContent: 'center' },
  knob: { width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: 'rgba(255,255,255,0.92)', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  arrow: { position: 'absolute', alignSelf: 'center' },
  arrowH: { position: 'absolute', top: SIZE / 2 - 7 },
  zoom: { width: 52, borderRadius: 26, backgroundColor: onVideo.glass, borderWidth: StyleSheet.hairlineWidth, borderColor: onVideo.border, overflow: 'hidden' },
  zoomBtn: { height: 56, alignItems: 'center', justifyContent: 'center' },
  zoomDivider: { height: StyleSheet.hairlineWidth, backgroundColor: onVideo.border, marginHorizontal: 10 },
  presets: { gap: space.sm, paddingHorizontal: space.lg },
  preset: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: onVideo.glass, borderWidth: StyleSheet.hairlineWidth, borderColor: onVideo.border },
  presetText: { color: '#fff', fontFamily: fonts.medium, fontSize: 13 },
});
