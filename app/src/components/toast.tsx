import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { radius, space, type } from '@/theme';

import { Icon } from './icon';
import type { IconName } from './icon-names';

type Toast = { id: number; text: string; icon?: IconName; tone: 'good' | 'bad' | 'info' };

const useToast = create<{ current: Toast | null }>()(() => ({ current: null }));
let seq = 0;

export function toast(text: string, tone: Toast['tone'] = 'good', icon?: IconName) {
  useToast.setState({ current: { id: ++seq, text, tone, icon } });
}

export function ToastHost() {
  const current = useToast((s) => s.current);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!current) return;
    const id = setTimeout(() => {
      if (useToast.getState().current?.id === current.id) useToast.setState({ current: null });
    }, 2600);
    return () => clearTimeout(id);
  }, [current]);
  if (!current) return null;
  const color = current.tone === 'good' ? '#2DD4BF' : current.tone === 'bad' ? '#FF6369' : '#FFFFFF';
  const icon = current.icon ?? (current.tone === 'good' ? 'checkCircle' : current.tone === 'bad' ? 'warning' : 'info');
  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + space.sm }]}>
      <Animated.View key={current.id} entering={FadeInUp.duration(220)} exiting={FadeOutUp.duration(180)} style={styles.toast}>
        <Icon name={icon} size={17} color={color} />
        <Text style={[type.callout, { color: '#fff', flexShrink: 1 }]} numberOfLines={2}>
          {current.text}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 2000, elevation: 2000 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(20,23,27,0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    maxWidth: '90%',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
});
