import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming, cancelAnimation } from 'react-native-reanimated';

import { useT } from '@/i18n';
import { MOTION_ACTIVE_MS, useMotion } from '@/lib/live-updates';
import type { Camera } from '@/lib/types';
import { fonts, onVideo, radius } from '@/theme';

import { Icon } from './icon';

export function useMotionActive(cameraId: string) {
  const last = useMotion((s) => s.last[cameraId] ?? 0);
  const [now, setNow] = useState(() => Date.now());
  const active = now - last < MOTION_ACTIVE_MS;
  useEffect(() => {
    if (!last) return;
    setNow(Date.now());
    const remaining = MOTION_ACTIVE_MS - (Date.now() - last);
    if (remaining <= 0) return;
    const id = setTimeout(() => setNow(Date.now()), remaining + 50);
    return () => clearTimeout(id);
  }, [last]);
  return active;
}

export function RecDot({ size = 7 }: { size?: number }) {
  const o = useSharedValue(1);
  useEffect(() => {
    o.value = withRepeat(withTiming(0.3, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(o);
  }, [o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#FF5A5F' }, style]} />;
}

export function MotionPulse({ active, radius: r = radius.md }: { active: boolean; radius?: number }) {
  const o = useSharedValue(0);
  useEffect(() => {
    if (active) o.value = withRepeat(withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }), -1, true);
    else {
      cancelAnimation(o);
      o.value = withTiming(0, { duration: 300 });
    }
  }, [active, o]);
  const style = useAnimatedStyle(() => ({ opacity: 0.35 + o.value * 0.65 * (active ? 1 : 0) }));
  if (!active) return null;
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: r, borderWidth: 2, borderColor: '#F5B544' }, style]} />;
}

export function StatusChips({ camera, motion, compact }: { camera: Camera; motion: boolean; compact?: boolean }) {
  const { t } = useT();
  const online = camera.status.online && camera.enabled;
  return (
    <View style={styles.row}>
      {!online ? (
        <View style={[styles.chip, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
          <Icon name="offline" size={10} color="#FFB4B6" />
          {!compact ? <Text style={[styles.text, { color: '#FFB4B6' }]}>{camera.enabled ? t('live.offline') : t('live.disabled')}</Text> : null}
        </View>
      ) : null}
      {online && camera.status.recording ? (
        <View style={styles.chip}>
          <RecDot size={6} />
          {!compact ? <Text style={styles.text}>{t('live.rec')}</Text> : null}
        </View>
      ) : null}
      {online && motion ? (
        <View style={[styles.chip, { backgroundColor: 'rgba(245,181,68,0.92)' }]}>
          <Icon name="motion" size={10} color="#1A1204" />
          {!compact ? <Text style={[styles.text, { color: '#1A1204' }]}>{t('live.motion')}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, height: 20, borderRadius: radius.pill, backgroundColor: onVideo.glass },
  text: { color: '#fff', fontFamily: fonts.semibold, fontSize: 10.5, letterSpacing: 0.4 },
});
