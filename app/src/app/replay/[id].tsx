import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlaybackView } from '@/components/playback-view';
import { Button, Loading } from '@/components/ui';
import { GlassButton } from '@/components/video-controls';
import { useT } from '@/i18n';
import { useCamera } from '@/lib/data';
import { fonts, space } from '@/theme';

export default function Replay() {
  const { id, at } = useLocalSearchParams<{ id: string; at?: string; event?: string }>();
  const { camera, cameras } = useCamera(id);
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const initialAt = at ? Date.parse(at) : undefined;

  if (!camera) {
    return (
      <View style={[styles.root, styles.center]}>
        {cameras ? (
          <>
            <Text style={styles.title}>{t('live.notFound')}</Text>
            <Button title={t('common.close')} variant="ink" compact onPress={close} />
          </>
        ) : (
          <Loading />
        )}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" hidden={width > height} />
      <PlaybackView
        camera={camera}
        initialAt={Number.isFinite(initialAt) ? initialAt : undefined}
        dark
        onClose={close}
        header={
          <View style={[styles.header, { paddingTop: insets.top + space.xs }]}>
            <GlassButton icon="chevronDown" label={t('common.close')} onPress={close} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>
                {camera.name}
              </Text>
              <Text style={styles.sub}>{t('tabs.playback')}</Text>
            </View>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', gap: space.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.md },
  title: { color: '#fff', fontFamily: fonts.semibold, fontSize: 17 },
  sub: { color: 'rgba(255,255,255,0.6)', fontFamily: fonts.medium, fontSize: 12 },
});
