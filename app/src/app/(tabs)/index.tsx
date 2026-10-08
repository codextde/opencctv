import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View, type ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showActions } from '@/components/action-sheet';
import { AddTile, CameraTile } from '@/components/camera-tile';
import { ConnectionNotice } from '@/components/connection-notice';
import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { ScreenTitle } from '@/components/server-switcher';
import { EmptyState, IconButton, Loading, tap } from '@/components/ui';
import { useT } from '@/i18n';
import { saveSnapshot, shareSnapshot } from '@/lib/camera-actions';
import { useApi } from '@/lib/connection';
import { groupsOf, useCameras } from '@/lib/data';
import { enablePush, isDemoServer } from '@/lib/push';
import type { Camera } from '@/lib/types';
import { useSettings, type GridColumns } from '@/store/settings';
import { radius, space, type, useColors } from '@/theme';

const GAP = 10;
const MAX_GRID_VIDEOS = 6;

function columnsFor(pref: GridColumns, count: number, landscape: boolean, width: number) {
  if (pref !== 'auto') return landscape && pref === 1 ? 2 : pref;
  if (landscape) return count <= 4 ? 2 : 3;
  if (width >= 700) return count <= 2 ? 1 : count <= 6 ? 2 : 3;
  return count <= 2 ? 1 : 2;
}

function GroupChips({ groups, value, onChange }: { groups: string[]; value: string | null; onChange: (g: string | null) => void }) {
  const c = useColors();
  const { t } = useT();
  if (!groups.length) return null;
  const items: (string | null)[] = [null, ...groups];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={{ marginBottom: space.lg, marginHorizontal: -space.lg }}>
      {items.map((g) => {
        const active = g === value;
        return (
          <PressableScale
            key={g ?? '__all'}
            onPress={() => {
              tap();
              onChange(g);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.chip, { backgroundColor: active ? c.text : c.surface, borderColor: active ? c.text : c.border }]}>
            <Text style={[type.callout, { color: active ? c.background : c.text }]}>{g ?? t('live.allCameras')}</Text>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}

function PushPrompt() {
  const c = useColors();
  const { t } = useT();
  const { api } = useApi();
  const set = useSettings((s) => s.set);
  const [busy, setBusy] = useState(false);
  return (
    <View style={[styles.prompt, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={[styles.promptIcon, { backgroundColor: c.accentSoft }]}>
        <Icon name="bell" size={18} color={c.accentStrong} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.bodyStrong, { color: c.text }]}>{t('push.promptTitle')}</Text>
        <Text style={[type.caption, { color: c.textSecondary }]}>{t('push.promptBody')}</Text>
        <View style={styles.promptActions}>
          <PressableScale
            onPress={async () => {
              setBusy(true);
              const res = await enablePush([api]);
              setBusy(false);
              set({ pushPrompted: true, notifications: res === 'ok' });
            }}
            style={[styles.promptButton, { backgroundColor: c.accent }]}>
            <Text style={[type.callout, { color: c.onAccent }]}>{busy ? '…' : t('push.enable')}</Text>
          </PressableScale>
          <PressableScale onPress={() => set({ pushPrompted: true })} style={styles.promptButton}>
            <Text style={[type.callout, { color: c.textSecondary }]}>{t('common.notNow')}</Text>
          </PressableScale>
        </View>
      </View>
    </View>
  );
}

export default function Live() {
  const { t } = useT();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { api, isAdmin, server } = useApi();
  const { cameras, error, loading, refreshing, refetch } = useCameras({ intervalMs: 20000 });
  const gridColumns = useSettings((s) => s.gridColumns);
  const gridVideo = useSettings((s) => s.gridVideo);
  const group = useSettings((s) => s.group);
  const pushPrompted = useSettings((s) => s.pushPrompted);
  const set = useSettings((s) => s.set);
  const [visible, setVisible] = useState<Set<string>>(new Set());

  const groups = useMemo(() => groupsOf(cameras), [cameras]);
  const activeGroup = group && groups.includes(group) ? group : null;
  const list = useMemo(() => (cameras ?? []).filter((cam) => !activeGroup || cam.group?.trim() === activeGroup), [cameras, activeGroup]);

  const landscape = width > height;
  const padH = space.lg + (landscape ? Math.max(insets.left, insets.right) : 0);
  const contentWidth = width - padH * 2;
  const cols = columnsFor(gridColumns, list.length, landscape, width);
  const tileWidth = Math.floor((contentWidth - GAP * (cols - 1)) / cols);
  const videoAllowed = gridVideo && visible.size <= MAX_GRID_VIDEOS;

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    setVisible(new Set(viewableItems.map((v) => (v.item === 'add' ? 'add' : (v.item as Camera).id))));
  }).current;

  const cycleLayout = () => {
    const order: GridColumns[] = ['auto', 1, 2, 3];
    const next = order[(order.indexOf(gridColumns) + 1) % order.length];
    set({ gridColumns: next });
  };

  const openMenu = useCallback(
    (cam: Camera) => {
      showActions({
        title: cam.name,
        actions: [
          { label: t('live.fullscreen'), icon: 'expand', onPress: () => router.push(`/camera/${cam.id}`) },
          { label: t('live.openPlayback'), icon: 'playback', onPress: () => router.push(`/replay/${cam.id}`) },
          { label: t('live.saveSnapshot'), icon: 'download', disabled: !cam.status.online, onPress: () => saveSnapshot(api, cam) },
          { label: t('live.shareSnapshot'), icon: 'share', disabled: !cam.status.online, onPress: () => shareSnapshot(api, cam) },
          ...(isAdmin
            ? [
                { label: t('live.cameraSettings'), icon: 'sliders' as const, onPress: () => router.push(`/manage/camera/${cam.id}`) },
                { label: t('live.reorder'), icon: 'reorder' as const, onPress: () => router.push({ pathname: '/manage/cameras', params: { reorder: '1' } }) },
              ]
            : []),
        ],
      });
    },
    [api, isAdmin, t],
  );

  const layoutIcon = gridColumns === 1 ? 'grid1' : gridColumns === 3 ? 'grid3' : 'grid';
  const data: (Camera | 'add')[] = isAdmin && list.length > 0 && !activeGroup ? [...list, 'add'] : list;

  const header = (
    <View>
      <ScreenTitle
        title={t('tabs.live')}
        right={
          <>
            <IconButton icon={layoutIcon} label={t('live.layout')} onPress={cycleLayout} />
            {isAdmin ? <IconButton icon="plus" label={t('manage.addCamera')} onPress={() => router.push('/manage/add-camera')} /> : null}
          </>
        }
      />
      <ConnectionNotice error={error} onRetry={refetch} />
      {!pushPrompted && !isDemoServer(server) && cameras && cameras.length > 0 ? <PushPrompt /> : null}
      <GroupChips groups={groups} value={activeGroup} onChange={(g) => set({ group: g })} />
    </View>
  );

  return (
    <FlatList
      key={`cols-${cols}`}
      style={{ backgroundColor: c.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        paddingHorizontal: padH,
        paddingTop: Platform.OS === 'ios' ? space.sm : insets.top + space.md,
        paddingBottom: Platform.OS === 'ios' ? 120 : insets.bottom + 110,
        gap: GAP,
      }}
      columnWrapperStyle={cols > 1 ? { gap: GAP } : undefined}
      numColumns={cols}
      data={data}
      keyExtractor={(item) => (item === 'add' ? 'add' : item.id)}
      ListHeaderComponent={header}
      ListEmptyComponent={
        loading ? (
          <Loading />
        ) : cameras ? (
          <EmptyState
            icon="camera"
            title={activeGroup ? t('live.emptyGroup') : t('live.empty')}
            body={isAdmin ? t('live.emptyAdmin') : t('live.emptyViewer')}
            action={isAdmin ? t('manage.addCamera') : undefined}
            onAction={() => router.push('/manage/add-camera')}
          />
        ) : null
      }
      renderItem={({ item }) =>
        item === 'add' ? (
          <AddTile width={tileWidth} label={t('manage.addCamera')} onPress={() => router.push('/manage/add-camera')} />
        ) : (
          <CameraTile
            camera={item}
            api={api}
            width={tileWidth}
            compact={cols >= 3}
            video={videoAllowed}
            visible={visible.has(item.id)}
            onPress={() => router.push(`/camera/${item.id}`)}
            onLongPress={() => openMenu(item)}
          />
        )
      }
      onViewableItemsChanged={onViewable}
      viewabilityConfig={{ itemVisiblePercentThreshold: 30, minimumViewTime: 150 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetch} tintColor={c.textSecondary} />}
      extraData={`${server.id}-${videoAllowed}-${visible.size}`}
    />
  );
}

const styles = StyleSheet.create({
  chips: { gap: space.sm, paddingHorizontal: space.lg },
  chip: { paddingHorizontal: 14, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  prompt: { flexDirection: 'row', gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, marginBottom: space.lg },
  promptIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  promptActions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  promptButton: { paddingHorizontal: 14, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
