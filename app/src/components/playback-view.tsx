import { Image } from 'expo-image';
import { useKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';
import { exportClip } from '@/lib/camera-actions';
import { useApi } from '@/lib/connection';
import { clock, dayLabel, deviceTimeZone, formatDuration } from '@/lib/format';
import { useQuery } from '@/lib/query';
import { useSegmentPlayer } from '@/lib/segment-player';
import { clipWindow, dayKey, formatClock, toSpans } from '@/lib/timeline';
import type { Camera, MotionEvent, Timeline as TimelineData } from '@/lib/types';
import { useSettings } from '@/store/settings';
import { fonts, onVideo, radius, space, type, useColors } from '@/theme';

import { showActions } from './action-sheet';
import { Icon } from './icon';
import { PressableScale } from './pressable-scale';
import { Timeline } from './timeline';
import { toast } from './toast';
import { tap } from './ui';
import { GlassButton } from './video-controls';

const SPEEDS = [1, 2, 4, 8];

type Props = { camera: Camera; initialAt?: number; dark?: boolean; header?: React.ReactNode; onClose?: () => void };

function DayStrip({ days, value, onChange, dark }: { days: string[]; value: string; onChange: (d: string) => void; dark: boolean }) {
  const c = useColors();
  const { lang } = useT();
  const list = useMemo(() => {
    const set = new Set(days);
    set.add(dayKey(Date.now()));
    set.add(value);
    return [...set].sort((a, b) => (a < b ? 1 : -1)).slice(0, 30);
  }, [days, value]);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.lg }}>
      {list.map((d) => {
        const active = d === value;
        const has = days.includes(d);
        return (
          <PressableScale
            key={d}
            onPress={() => {
              tap();
              onChange(d);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[
              styles.day,
              { backgroundColor: active ? (dark ? '#fff' : c.text) : dark ? 'rgba(255,255,255,0.08)' : c.surface, borderColor: dark ? 'rgba(255,255,255,0.08)' : c.border },
            ]}>
            <Text style={[type.callout, { color: active ? (dark ? '#000' : c.background) : has ? (dark ? '#fff' : c.text) : dark ? 'rgba(255,255,255,0.4)' : c.textTertiary }]}>{dayLabel(d, lang)}</Text>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}

function EventRow({ event, thumb, onPress, active, dark }: { event: MotionEvent; thumb: string; onPress: () => void; active: boolean; dark: boolean }) {
  const c = useColors();
  const { t } = useT();
  const start = Date.parse(event.start);
  const dur = event.end ? Math.max(1, Math.round((Date.parse(event.end) - start) / 1000)) : null;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.eventRow, (pressed || active) && { backgroundColor: dark ? 'rgba(255,255,255,0.06)' : c.surfacePressed }]} accessibilityRole="button">
      <Image source={{ uri: thumb }} style={styles.eventThumb} contentFit="cover" transition={150} recyclingKey={event.id} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.bodyStrong, { color: dark ? '#fff' : c.text }]}>{clock(start, true)}</Text>
        <Text style={[type.caption, { color: dark ? onVideo.textSecondary : c.textSecondary }]}>
          {t('events.motion')}
          {dur ? ` · ${formatDuration(dur)}` : ''}
        </Text>
      </View>
      <Icon name="play" size={14} color={dark ? onVideo.textSecondary : c.textTertiary} />
    </Pressable>
  );
}

export function PlaybackView({ camera, initialAt, dark = false, header, onClose }: Props) {
  const { t, lang } = useT();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { api, scope } = useApi();
  const startMuted = useSettings((s) => s.startMuted);
  useKeepAwake();

  const [day, setDay] = useState(() => dayKey(initialAt ?? Date.now()));
  const [rate, setRate] = useState(1);
  const [muted, setMuted] = useState(startMuted);
  const [scrub, setScrub] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const pendingSeek = useRef<number | null>(initialAt ?? null);
  const initializedFor = useRef<string | null>(null);

  const isToday = day === dayKey(Date.now());
  const tl = useQuery<TimelineData>(`${scope}timeline:${camera.id}:${day}`, () => api.timeline(camera.id, day, deviceTimeZone()), {
    intervalMs: isToday ? 30000 : undefined,
    staleMs: 10000,
  });
  const spans = useMemo(() => toSpans(tl.data?.ranges ?? []), [tl.data]);
  const events = useMemo(() => [...(tl.data?.events ?? [])].sort((a, b) => Date.parse(b.start) - Date.parse(a.start)), [tl.data]);
  const days = tl.data?.days ?? [];

  const urlFor = useCallback((rid: string) => api.media(`/api/recordings/${rid}/video.mp4`), [api]);
  const player = useSegmentPlayer(spans, { urlFor, muted, rate });

  useEffect(() => {
    const key = `${camera.id}:${day}`;
    if (!tl.data || initializedFor.current === key) return;
    initializedFor.current = key;
    if (!spans.length) return;
    const at = pendingSeek.current;
    pendingSeek.current = null;
    const last = spans[spans.length - 1];
    player.seek(at ?? Math.max(last.start, last.end - 60000), { play: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tl.data, camera.id, day, spans]);

  const landscape = width > height;
  const videoHeight = landscape ? height : Math.round((width * 9) / 16);
  const shown = scrub ?? player.time;
  const fg = dark ? '#fff' : c.text;
  const fg2 = dark ? onVideo.textSecondary : c.textSecondary;

  const jump = (deltaSec: number) => {
    if (player.time === null) return;
    tap();
    player.seek(player.time + deltaSec * 1000);
  };

  const cycleRate = () => {
    const next = SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length];
    setRate(next);
  };

  const clip = () => {
    if (player.time === null) return;
    const at = player.time;
    const run = (len: number, mode: 'save' | 'share') => {
      const w = clipWindow(at, len, spans);
      setExporting(true);
      toast(t('playback.preparing'), 'info', 'clip');
      exportClip(api, camera, w.start, w.end, mode)
        .catch(() => toast(t('playback.clipFailed'), 'bad'))
        .finally(() => setExporting(false));
    };
    const pickMode = (len: number) =>
      showActions({
        title: t('playback.clipTitle'),
        actions: [
          { label: t('playback.saveClip'), icon: 'download', onPress: () => run(len, 'save') },
          { label: t('playback.shareClip'), icon: 'share', onPress: () => run(len, 'share') },
        ],
      });
    showActions({
      title: t('playback.clipTitle'),
      message: t('playback.clipBody', { time: formatClock(at) }),
      actions: [
        { label: t('playback.clip30'), icon: 'clip', onPress: () => pickMode(30) },
        { label: t('playback.clip60'), icon: 'clip', onPress: () => pickMode(60) },
        { label: t('playback.clip300'), icon: 'clip', onPress: () => pickMode(300) },
      ],
    });
  };

  const changeDay = (d: string) => {
    if (d === day) return;
    player.pause();
    pendingSeek.current = null;
    setDay(d);
  };

  const seekEvent = (e: MotionEvent) => {
    tap();
    player.seek(Date.parse(e.start) - 3000, { play: true });
  };

  const empty = tl.data && !spans.length;

  const video = (
    <View style={{ width, height: videoHeight, backgroundColor: '#000' }}>
      {player.players.map((p, i) => (
        <VideoView
          key={i}
          player={p}
          style={[StyleSheet.absoluteFill, { opacity: player.active === i ? 1 : 0 }]}
          contentFit="contain"
          nativeControls={false}
          allowsVideoFrameAnalysis={false}
          allowsPictureInPicture={player.active === i}
          surfaceType={Platform.OS === 'android' ? 'textureView' : undefined}
        />
      ))}
      {shown !== null ? (
        <View testID={player.playing ? 'playback-playing' : undefined} style={[styles.timeChip, { top: landscape ? insets.top + space.md : space.md }]}>
          {scrub !== null ? <Icon name="search" size={11} color="#fff" /> : null}
          <Text style={styles.timeText}>{formatClock(shown)}</Text>
        </View>
      ) : null}
      {player.buffering && !empty ? (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator color="#fff" />
        </View>
      ) : null}
      {empty ? (
        <View style={styles.center}>
          <Icon name="playback" size={28} color="rgba(255,255,255,0.5)" />
          <Text style={styles.emptyText}>{t('playback.noFootage')}</Text>
        </View>
      ) : null}
      {tl.loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : null}
      {player.error && !empty ? (
        <View style={styles.center}>
          <Icon name="warning" size={24} color="rgba(255,255,255,0.7)" />
          <Text style={styles.emptyText}>{t('playback.error')}</Text>
        </View>
      ) : null}
    </View>
  );

  const controls = (
    <View style={styles.controls}>
      <GlassButton icon={muted ? 'speakerOff' : 'speaker'} label={muted ? t('live.unmute') : t('live.mute')} onPress={() => setMuted((m) => !m)} size={42} />
      <GlassButton icon="back10" label={t('playback.back10')} onPress={() => jump(-10)} size={46} />
      <GlassButton icon={player.playing ? 'pause' : 'play'} label={player.playing ? t('playback.pause') : t('playback.play')} onPress={player.toggle} size={60} />
      <GlassButton icon="fwd10" label={t('playback.fwd10')} onPress={() => jump(10)} size={46} />
      <GlassButton icon="speed" badge={`${rate}×`} label={t('playback.speed')} onPress={cycleRate} active={rate !== 1} size={42} />
    </View>
  );

  const timeline = (
    <Timeline
      day={day}
      spans={spans}
      events={tl.data?.events ?? []}
      time={player.time}
      dark={dark || landscape}
      onScrub={setScrub}
      onSeek={(time) => {
        setScrub(null);
        player.seek(time);
      }}
    />
  );

  if (landscape) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {video}
        <View style={[styles.landscapeOverlay, { paddingLeft: Math.max(insets.left, space.lg), paddingRight: Math.max(insets.right, space.lg), paddingBottom: Math.max(insets.bottom, space.md) }]}>
          <View style={styles.landscapeTop}>
            {onClose ? <GlassButton icon="chevronDown" label={t('common.close')} onPress={onClose} size={40} /> : null}
            <Text style={[type.bodyStrong, { color: '#fff', flex: 1 }]} numberOfLines={1}>
              {camera.name} · {dayLabel(day, lang)}
            </Text>
            <GlassButton icon="clip" label={t('playback.clip')} onPress={clip} size={40} disabled={exporting || player.time === null} />
          </View>
          <View style={{ flex: 1 }} />
          {timeline}
          {controls}
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: dark ? '#000' : c.background }}>
      {header}
      {video}
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + (dark ? space.xl : 120) }} showsVerticalScrollIndicator={false}>
        <View style={[styles.bar, { paddingHorizontal: space.lg }]}>
          <View style={{ flex: 1 }}>
            <Text style={[type.headline, { color: fg }]} numberOfLines={1}>
              {dayLabel(day, lang)}
            </Text>
            <Text style={[type.caption, { color: fg2 }]}>{t('playback.events', { n: events.length })}</Text>
          </View>
          <PressableScale onPress={clip} disabled={exporting || player.time === null} style={[styles.pill, { backgroundColor: dark ? 'rgba(255,255,255,0.1)' : c.surface, borderColor: dark ? 'transparent' : c.border, opacity: exporting || player.time === null ? 0.5 : 1 }]}>
            {exporting ? <ActivityIndicator size="small" color={fg} /> : <Icon name="clip" size={14} color={fg} />}
            <Text style={[type.callout, { color: fg }]}>{t('playback.clip')}</Text>
          </PressableScale>
          <PressableScale onPress={() => router.push(`/camera/${camera.id}`)} style={[styles.pill, { backgroundColor: c.accent }]}>
            <View style={styles.liveDot} />
            <Text style={[type.callout, { color: c.onAccent }]}>{t('playback.live')}</Text>
          </PressableScale>
        </View>
        <View style={{ marginTop: space.sm }}>{timeline}</View>
        <View style={[styles.controlsWrap, { backgroundColor: dark ? 'transparent' : 'transparent' }]}>{controls}</View>
        <DayStrip days={days} value={day} onChange={changeDay} dark={dark} />
        <Animated.View entering={FadeIn} style={{ marginTop: space.lg, paddingHorizontal: space.sm }}>
          {events.length === 0 && tl.data ? <Text style={[type.callout, { color: fg2, textAlign: 'center', paddingVertical: space.xl }]}>{t('playback.noEvents')}</Text> : null}
          {events.map((e) => (
            <EventRow
              key={e.id}
              event={e}
              thumb={api.media(e.snapshotUrl)}
              dark={dark}
              active={player.time !== null && Math.abs(player.time - Date.parse(e.start)) < 15000}
              onPress={() => seekEvent(e)}
            />
          ))}
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  emptyText: { color: 'rgba(255,255,255,0.7)', fontFamily: fonts.medium, fontSize: 14 },
  timeChip: { position: 'absolute', left: space.md, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 26, borderRadius: 13, backgroundColor: onVideo.glass },
  timeText: { color: '#fff', fontFamily: fonts.semibold, fontSize: 13, fontVariant: ['tabular-nums'] },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingTop: space.lg },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent' },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#03201C' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.lg },
  controlsWrap: { paddingVertical: space.lg },
  day: { height: 34, paddingHorizontal: 14, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: radius.md },
  eventThumb: { width: 96, height: 54, borderRadius: radius.sm, backgroundColor: '#111' },
  landscapeOverlay: { ...StyleSheet.absoluteFill, gap: space.sm, paddingTop: space.md },
  landscapeTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
