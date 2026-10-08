import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import type { IconName } from '@/components/icon-names';
import { Button, IconButton, Loading } from '@/components/ui';
import { useT } from '@/i18n';
import { parsePairLink } from '@/lib/url';
import { radius, space, type, useColors } from '@/theme';

function Point({ icon, text }: { icon: IconName; text: string }) {
  const c = useColors();
  return (
    <View style={styles.point}>
      <View style={[styles.pointIcon, { backgroundColor: c.surfaceSunken }]}>
        <Icon name={icon} size={16} color={c.accentStrong} />
      </View>
      <Text style={[type.callout, { color: c.textSecondary, flex: 1 }]}>{text}</Text>
    </View>
  );
}

export default function Scan() {
  const { t } = useT();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [asked, setAsked] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const handled = useRef(false);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const top = Platform.OS === 'android' ? insets.top + space.md : space.lg;

  const onScan = (data: string) => {
    if (handled.current) return;
    const link = parsePairLink(data);
    if (!link) {
      setInvalid(true);
      return;
    }
    handled.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    router.replace({ pathname: '/pair', params: { server: link.server, code: link.code } });
  };

  if (!permission) return <Loading style={{ flex: 1, backgroundColor: c.background }} />;

  if (permission.granted) {
    return (
      <View style={styles.cameraRoot}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={(r) => onScan(r.data)}
        />
        <View style={[styles.overlay, { paddingTop: top, paddingBottom: insets.bottom + space.xl }]} pointerEvents="box-none">
          <View style={styles.cameraTop}>
            <IconButton icon="close" label={t('common.close')} onPress={close} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} tint="#fff" />
          </View>
          <View style={styles.frameWrap} pointerEvents="none">
            <View style={[styles.frame, { borderColor: invalid ? c.warn : '#fff' }]} />
          </View>
          <Animated.View entering={FadeIn} style={styles.cameraHint}>
            <Text style={[type.bodyStrong, { color: '#fff', textAlign: 'center' }]}>{invalid ? t('scan.invalid') : t('scan.aim')}</Text>
            <Button title={t('scan.manual')} variant="ink" compact onPress={() => router.replace('/connect')} />
          </Animated.View>
        </View>
      </View>
    );
  }

  const denied = !permission.canAskAgain || (asked && !permission.granted);

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: top, paddingBottom: insets.bottom + space.xl }]}>
      <View style={styles.cameraTop}>
        <View />
        <IconButton icon="close" label={t('common.close')} onPress={close} />
      </View>
      <View style={styles.explain}>
        <View style={[styles.hero, { backgroundColor: c.accentSoft }]}>
          <Icon name="qr" size={44} color={c.accentStrong} />
        </View>
        <Text style={[type.title, { color: c.text, textAlign: 'center' }]}>{t('scan.title')}</Text>
        <Text style={[type.body, { color: c.textSecondary, textAlign: 'center' }]}>{t('scan.body')}</Text>
        <View style={styles.points}>
          <Point icon="server" text={t('scan.step1')} />
          <Point icon="qr" text={t('scan.step2')} />
          <Point icon="lock" text={t('scan.privacy')} />
        </View>
      </View>
      <View style={styles.actions}>
        {denied ? (
          <>
            <Text style={[type.caption, { color: c.textSecondary, textAlign: 'center' }]}>{t('scan.denied')}</Text>
            <Button title={t('common.openSettings')} onPress={() => Linking.openSettings()} />
          </>
        ) : (
          <Button
            title={t('scan.allow')}
            icon="snapshot"
            onPress={async () => {
              setAsked(true);
              await requestPermission();
            }}
          />
        )}
        <Button title={t('scan.manual')} variant="ghost" onPress={() => router.replace('/connect')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space.xl },
  cameraRoot: { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1, justifyContent: 'space-between', paddingHorizontal: space.xl },
  cameraTop: { flexDirection: 'row', justifyContent: 'space-between' },
  frameWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: { width: 240, height: 240, borderRadius: radius.xl, borderWidth: 3 },
  cameraHint: { alignItems: 'center', gap: space.md, backgroundColor: 'rgba(0,0,0,0.55)', padding: space.lg, borderRadius: radius.lg },
  explain: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: space.md },
  hero: { width: 96, height: 96, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginBottom: space.md },
  points: { alignSelf: 'stretch', gap: space.md, marginTop: space.lg },
  point: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  pointIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  actions: { gap: space.sm },
});
