import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConnectionNotice } from '@/components/connection-notice';
import { PlaybackView } from '@/components/playback-view';
import { PressableScale } from '@/components/pressable-scale';
import { ScreenTitle } from '@/components/server-switcher';
import { EmptyState, IconButton, Loading, tap } from '@/components/ui';
import { useT } from '@/i18n';
import { useCameras } from '@/lib/data';
import { radius, space, type, useColors } from '@/theme';

export default function PlaybackTab() {
  const { t } = useT();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { cameras, error, refetch, loading } = useCameras();
  const [selected, setSelected] = useState<string | null>(null);
  const camera = cameras?.find((x) => x.id === selected) ?? cameras?.[0];

  const header = (
    <View style={{ paddingTop: Platform.OS === 'ios' ? insets.top + space.sm : insets.top + space.md }}>
      <View style={{ paddingHorizontal: space.lg }}>
        <ScreenTitle
          title={t('tabs.playback')}
          right={camera ? <IconButton icon="expand" label={t('live.fullscreen')} onPress={() => router.push(`/replay/${camera.id}`)} /> : null}
        />
        <ConnectionNotice error={error} onRetry={refetch} />
      </View>
      {cameras && cameras.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={{ marginBottom: space.md }}>
          {cameras.map((cam) => {
            const active = cam.id === camera?.id;
            return (
              <PressableScale
                key={cam.id}
                onPress={() => {
                  tap();
                  setSelected(cam.id);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.chip, { backgroundColor: active ? c.text : c.surface, borderColor: active ? c.text : c.border }]}>
                <Text style={[type.callout, { color: active ? c.background : c.text }]} numberOfLines={1}>
                  {cam.name}
                </Text>
              </PressableScale>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );

  if (!camera) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        {header}
        {loading ? <Loading /> : cameras ? <EmptyState icon="playback" title={t('playback.noCameras')} body={t('playback.noCamerasBody')} /> : null}
      </View>
    );
  }

  return <PlaybackView key={camera.id} camera={camera} header={header} />;
}

const styles = StyleSheet.create({
  chips: { gap: space.sm, paddingHorizontal: space.lg },
  chip: { paddingHorizontal: 14, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, maxWidth: 200 },
});
