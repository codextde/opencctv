import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConnectionNotice } from '@/components/connection-notice';
import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { ScreenTitle } from '@/components/server-switcher';
import { EmptyState, IconButton, Loading, tap } from '@/components/ui';
import { useT } from '@/i18n';
import { useApi } from '@/lib/connection';
import { useCameras } from '@/lib/data';
import { clock, dayLabel, formatDuration, relativeTime } from '@/lib/format';
import { useQuery } from '@/lib/query';
import { dayBounds, dayKey, shiftDay } from '@/lib/timeline';
import type { MotionEvent, Page } from '@/lib/types';
import { radius, space, type, useColors } from '@/theme';

const PAGE = 40;

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <PressableScale
      onPress={() => {
        tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.chip, { backgroundColor: active ? c.text : c.surface, borderColor: active ? c.text : c.border }]}>
      <Text style={[type.callout, { color: active ? c.background : c.text }]} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

export default function Events() {
  const { t, lang } = useT();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { api, scope } = useApi();
  const { cameras } = useCameras();
  const [camera, setCamera] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [more, setMore] = useState<MotionEvent[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const bounds = day ? dayBounds(day) : null;
  const key = `${scope}events:${camera ?? 'all'}:${day ?? 'all'}`;
  const q = useQuery<Page<MotionEvent>>(
    key,
    () =>
      api.events({
        camera: camera ?? undefined,
        from: bounds ? new Date(bounds.start).toISOString() : undefined,
        before: bounds ? new Date(bounds.end).toISOString() : undefined,
        limit: PAGE,
      }),
    { intervalMs: 30000, staleMs: 5000 },
  );

  useEffect(() => {
    setMore([]);
    setCursor(q.data?.nextCursor);
  }, [q.data]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.events({ camera: camera ?? undefined, from: bounds ? new Date(bounds.start).toISOString() : undefined, before: cursor, limit: PAGE });
      setMore((m) => [...m, ...page.items]);
      setCursor(page.nextCursor);
    } catch {
    } finally {
      setLoadingMore(false);
    }
  };

  const names = useMemo(() => Object.fromEntries((cameras ?? []).map((cam) => [cam.id, cam.name])), [cameras]);
  const sections = useMemo(() => {
    const seen = new Set<string>();
    const all = [...(q.data?.items ?? []), ...more].filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
    const groups = new Map<string, MotionEvent[]>();
    for (const e of all) {
      const k = dayKey(Date.parse(e.start));
      const list = groups.get(k) ?? [];
      list.push(e);
      groups.set(k, list);
    }
    return [...groups.entries()].map(([k, data]) => ({ key: k, title: dayLabel(k, lang), data }));
  }, [q.data, more, lang]);

  const today = dayKey(Date.now());
  const dayOptions = Array.from({ length: 7 }, (_, i) => shiftDay(today, -i));
  const filtered = camera !== null || day !== null;

  const header = (
    <View>
      <ScreenTitle
        title={t('tabs.events')}
        right={<IconButton icon="filter" label={t('events.filter')} onPress={() => setShowFilters((v) => !v)} tint={filtered ? c.accentStrong : undefined} />}
      />
      <ConnectionNotice error={q.error} onRetry={q.refetch} />
      {showFilters || filtered ? (
        <View style={{ gap: space.sm, marginBottom: space.lg }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipRow}>
            <Chip label={t('events.allCameras')} active={camera === null} onPress={() => setCamera(null)} />
            {(cameras ?? []).map((cam) => (
              <Chip key={cam.id} label={cam.name} active={camera === cam.id} onPress={() => setCamera(cam.id)} />
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipRow}>
            <Chip label={t('events.allDays')} active={day === null} onPress={() => setDay(null)} />
            {dayOptions.map((d) => (
              <Chip key={d} label={dayLabel(d, lang)} active={day === d} onPress={() => setDay(d)} />
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );

  return (
    <SectionList
      style={{ backgroundColor: c.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: Platform.OS === 'ios' ? space.sm : insets.top + space.md, paddingBottom: Platform.OS === 'ios' ? 120 : insets.bottom + 110 }}
      sections={sections}
      keyExtractor={(e) => e.id}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={header}
      renderSectionHeader={({ section }) => <Text style={[type.label, styles.section, { color: c.textTertiary }]}>{section.title}</Text>}
      renderItem={({ item, index, section }) => {
        const start = Date.parse(item.start);
        const dur = item.end ? Math.max(1, Math.round((Date.parse(item.end) - start) / 1000)) : null;
        const first = index === 0;
        const last = index === section.data.length - 1;
        return (
          <Pressable
            onPress={() => {
              tap();
              router.push({ pathname: '/replay/[id]', params: { id: item.cameraId, at: new Date(start - 3000).toISOString(), event: item.id } });
            }}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: pressed ? c.surfacePressed : c.surface, borderColor: c.border },
              first && styles.rowFirst,
              last && styles.rowLast,
              !last && { borderBottomWidth: 0 },
            ]}>
            <Image source={{ uri: api.media(item.snapshotUrl) }} style={styles.thumb} contentFit="cover" transition={150} recyclingKey={item.id} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[type.bodyStrong, { color: c.text }]} numberOfLines={1}>
                {names[item.cameraId] ?? t('events.unknownCamera')}
              </Text>
              <View style={styles.meta}>
                <Icon name="motion" size={11} color={c.motion} />
                <Text style={[type.caption, { color: c.textSecondary }]} numberOfLines={1}>
                  {clock(start)}
                  {dur ? ` · ${formatDuration(dur)}` : ''}
                </Text>
              </View>
              <Text style={[type.caption, { color: c.textTertiary }]}>{relativeTime(start, lang)}</Text>
            </View>
            <Icon name="chevronRight" size={13} color={c.textTertiary} />
          </Pressable>
        );
      }}
      ListEmptyComponent={
        q.loading ? (
          <Loading />
        ) : q.data ? (
          <EmptyState icon="events" title={filtered ? t('events.emptyFiltered') : t('events.empty')} body={t('events.emptyBody')} />
        ) : null
      }
      ListFooterComponent={loadingMore ? <ActivityIndicator style={{ marginTop: space.lg }} color={c.textSecondary} /> : null}
      onEndReached={loadMore}
      onEndReachedThreshold={0.4}
      refreshControl={<RefreshControl refreshing={q.refreshing} onRefresh={q.refetch} tintColor={c.textSecondary} />}
    />
  );
}

const styles = StyleSheet.create({
  chipRow: { marginHorizontal: -space.lg },
  chips: { gap: space.sm, paddingHorizontal: space.lg },
  chip: { paddingHorizontal: 14, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, maxWidth: 200 },
  section: { marginTop: space.md, marginBottom: space.sm, marginHorizontal: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, paddingRight: space.md, borderWidth: StyleSheet.hairlineWidth },
  rowFirst: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  rowLast: { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg, marginBottom: space.sm },
  thumb: { width: 112, height: 63, borderRadius: radius.sm, backgroundColor: '#111' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
