import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DraggableList } from '@/components/draggable-list';
import { Icon } from '@/components/icon';
import { toast } from '@/components/toast';
import { Button, EmptyState, Loading, Screen, StatusDot, success } from '@/components/ui';
import { useT, type Key } from '@/i18n';
import { useApi } from '@/lib/connection';
import { useCameras } from '@/lib/data';
import { setQueryData } from '@/lib/query';
import type { Camera } from '@/lib/types';
import { fonts, radius, space, type, useColors } from '@/theme';

const ROW = 76;

const modeKey: Record<Camera['recording']['mode'], Key> = { continuous: 'cameras.modeContinuous', motion: 'cameras.modeMotion', off: 'cameras.modeOff' };

function CameraRow({ camera, handle, onPress }: { camera: Camera; handle?: React.ReactNode; onPress?: () => void }) {
  const c = useColors();
  const { t } = useT();
  const { api } = useApi();
  const online = camera.status.online && camera.enabled;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.surfacePressed : c.surface, borderColor: c.border }]}>
      <View style={styles.thumbWrap}>
        {online ? <Image source={{ uri: api.snapshotUrl(camera.id, 320) }} style={styles.thumb} contentFit="cover" cachePolicy="memory" /> : <Icon name="offline" size={16} color={c.textTertiary} />}
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[type.bodyStrong, { color: c.text }]} numberOfLines={1}>
          {camera.name}
        </Text>
        <View style={styles.meta}>
          <StatusDot color={online ? c.accent : c.danger} size={6} />
          <Text style={[type.caption, { color: c.textSecondary }]} numberOfLines={1}>
            {online ? t('live.online') : camera.enabled ? t('live.offline') : t('live.disabled')} · {t(modeKey[camera.recording.mode])}
            {camera.group ? ` · ${camera.group}` : ''}
          </Text>
        </View>
      </View>
      {handle ?? <Icon name="chevronRight" size={13} color={c.textTertiary} />}
    </Pressable>
  );
}

export default function Cameras() {
  const { reorder } = useLocalSearchParams<{ reorder?: string }>();
  const { t } = useT();
  const c = useColors();
  const { api, scope } = useApi();
  const { cameras, loading } = useCameras();
  const [editing, setEditing] = useState(reorder === '1');
  const [order, setOrder] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);

  const list = cameras ?? [];
  const sorted = order ? order.map((id) => list.find((x) => x.id === id)).filter((x): x is Camera => !!x) : list;

  const save = async () => {
    if (!order) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await api.reorder(order);
      setQueryData<Camera[]>(`${scope}cameras`, (prev) => prev?.map((cam) => ({ ...cam, order: order.indexOf(cam.id) })));
      success();
      setEditing(false);
      setOrder(null);
    } catch {
      toast(t('common.saveFailed'), 'bad');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen underHeader>
      <Stack.Screen
        options={{
          headerRight: () =>
            list.length > 1 ? (
              <Pressable onPress={editing ? save : () => setEditing(true)} hitSlop={10} disabled={saving} style={{ paddingHorizontal: 6 }}>
                <Text style={{ color: c.accentStrong, fontFamily: fonts.semibold, fontSize: 16 }}>{editing ? t('common.done') : t('cameras.reorder')}</Text>
              </Pressable>
            ) : null,
        }}
      />
      {loading ? <Loading /> : null}
      {cameras && !cameras.length ? (
        <EmptyState icon="camera" title={t('live.empty')} body={t('live.emptyAdmin')} action={t('manage.addCamera')} onAction={() => router.push('/manage/add-camera')} />
      ) : null}
      {editing ? (
        <>
          <Text style={[type.caption, { color: c.textSecondary, marginBottom: space.md, marginHorizontal: space.xs }]}>{t('cameras.reorderHint')}</Text>
          <DraggableList
            items={sorted}
            keyOf={(x) => x.id}
            rowHeight={ROW}
            onReorder={setOrder}
            renderHandle={() => (
              <View style={styles.handle}>
                <Icon name="reorder" size={18} color={c.textSecondary} />
              </View>
            )}
            renderItem={(cam, handle) => <CameraRow camera={cam} handle={handle} />}
          />
        </>
      ) : (
        <View>
          {sorted.map((cam) => (
            <View key={cam.id} style={{ height: ROW }}>
              <CameraRow camera={cam} onPress={() => router.push(`/manage/camera/${cam.id}`)} />
            </View>
          ))}
          {cameras?.length ? <Button title={t('manage.addCamera')} icon="plus" variant="secondary" onPress={() => router.push('/manage/add-camera')} style={{ marginTop: space.md }} /> : null}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { height: ROW - 8, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.sm, paddingRight: space.lg, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  thumbWrap: { width: 96, height: 54, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: '#121519', alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 96, height: 54 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  handle: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
});
