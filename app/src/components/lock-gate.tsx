import { Image } from 'expo-image';
import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';
import { useSettings } from '@/store/settings';
import { space, type } from '@/theme';

import { Button } from './ui';

const mark = require('../../assets/images/mark.png');

export function LockGate() {
  const enabled = useSettings((s) => s.appLock);
  const lockAfterSec = useSettings((s) => s.lockAfterSec);
  const [locked, setLocked] = useState(() => useSettings.getState().appLock);
  const [covered, setCovered] = useState(false);
  const busy = useRef(false);
  const backgroundAt = useRef<number | null>(null);
  const insets = useSafeAreaInsets();
  const { t } = useT();

  const unlock = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const has = await LocalAuthentication.hasHardwareAsync();
      const enrolled = has && (await LocalAuthentication.isEnrolledAsync());
      const level = await LocalAuthentication.getEnrolledLevelAsync();
      if (!enrolled && level === LocalAuthentication.SecurityLevel.NONE) {
        setLocked(false);
        return;
      }
      const res = await LocalAuthentication.authenticateAsync({ promptMessage: t('lock.prompt'), cancelLabel: t('common.cancel'), disableDeviceFallback: false });
      if (res.success) setLocked(false);
    } finally {
      busy.current = false;
    }
  }, [t]);

  useEffect(() => {
    if (!enabled) {
      setLocked(false);
      return;
    }
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        backgroundAt.current = Date.now();
        setCovered(true);
      } else if (state === 'inactive') {
        setCovered(true);
      } else if (state === 'active') {
        setCovered(false);
        const since = backgroundAt.current;
        backgroundAt.current = null;
        if (since && Date.now() - since >= lockAfterSec * 1000) setLocked(true);
      }
    });
    return () => sub.remove();
  }, [enabled, lockAfterSec]);

  useEffect(() => {
    if (locked && AppState.currentState === 'active') unlock();
  }, [locked, unlock]);

  if (!enabled || (!locked && !covered)) return null;

  return (
    <Animated.View exiting={FadeOut.duration(200)} style={[StyleSheet.absoluteFill, styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + space.xl }]}>
      <View style={styles.center}>
        <Image source={mark} style={styles.mark} contentFit="contain" />
        {locked ? <Text style={[type.headline, { color: '#fff' }]}>{t('lock.title')}</Text> : null}
      </View>
      {locked ? <Button title={t('lock.unlock')} icon="faceid" onPress={unlock} style={styles.button} /> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#0B0D10', zIndex: 1000, elevation: 1000, justifyContent: 'space-between' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg },
  mark: { width: 88, height: 88 },
  button: { marginHorizontal: space.xl },
});
