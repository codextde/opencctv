import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showActions } from '@/components/action-sheet';
import { StatusChips, useMotionActive } from '@/components/camera-badges';
import { Icon } from '@/components/icon';
import { LiveSnapshot } from '@/components/live-snapshot';
import { LiveStage, type StageHandle, type StageMode } from '@/components/live-stage';
import { PtzPad } from '@/components/ptz-pad';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui';
import { GlassButton, GlassPill, Shade } from '@/components/video-controls';
import { Zoomable } from '@/components/zoomable';
import { useT } from '@/i18n';
import { saveSnapshot, shareSnapshot } from '@/lib/camera-actions';
import { SCREENSHOT_MODE } from '@/lib/config';
import { useApi } from '@/lib/connection';
import { useCameras } from '@/lib/data';
import type { Camera } from '@/lib/types';
import { useSettings } from '@/store/settings';
import { fonts, onVideo, space } from '@/theme';

function TopBar({ camera, index, count, mode, quality, playing, onClose, onMore }: { camera: Camera; index: number; count: number; mode: StageMode; quality: 'hd' | 'sd'; playing: boolean; onClose: () => void; onMore: () => void }) {
  const { t } = useT();
  const motion = useMotionActive(camera.id);
  return (
    <View style={styles.topBar}>
      <GlassButton icon="chevronDown" label={t('common.close')} onPress={onClose} size={40} />
      <View style={styles.titleBlock}>
        <Text style={styles.title} numberOfLines={1}>
          {camera.name}
        </Text>
        <View style={styles.meta}>
          <StatusChips camera={camera} motion={motion} />
          {playing ? (
            <Text style={styles.metaText} testID="live-playing">
              {mode === 'lowLatency' ? t('live.lowLatency') : 'HLS'} · {quality.toUpperCase()}
              {camera.status.width && camera.status.height && quality === 'hd' ? ` · ${camera.status.height}p` : ''}
            </Text>
          ) : null}
        </View>
      </View>
      {count > 1 ? (
        <GlassPill>
          <Text style={styles.metaText}>
            {index + 1}/{count}
          </Text>
        </GlassPill>
      ) : null}
      <GlassButton icon="more" label={t('common.more')} onPress={onMore} size={40} />
    </View>
  );
}

export default function LiveFullscreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  const { api } = useApi();
  const { cameras } = useCameras();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  useKeepAwake();

  const liveMode = useSettings((s) => s.liveMode);
  const startMuted = useSettings((s) => s.startMuted);
  const preferHd = useSettings((s) => s.preferHd);
  const defaultMode: StageMode = liveMode === 'hls' ? 'hls' : 'lowLatency';

  const list = useMemo(() => cameras ?? [], [cameras]);
  const initial = Math.max(0, list.findIndex((c) => c.id === id));
  const [index, setIndex] = useState(initial);
  const [mode, setMode] = useState<StageMode>(defaultMode);
  const [quality, setQuality] = useState<'hd' | 'sd'>(preferHd ? 'hd' : 'sd');
  const [muted, setMuted] = useState(startMuted);
  const [controls, setControls] = useState(true);
  const [zoomed, setZoomed] = useState(false);
  const [ptzOpen, setPtzOpen] = useState(false);
  const [talking, setTalking] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [locked, setLocked] = useState<null | 'landscape' | 'portrait'>(null);
  const pager = useRef<FlatList<Camera>>(null);
  const stage = useRef<StageHandle>(null);
  const flash = useSharedValue(0);
  const landscape = width > height;
  const camera = list[index];

  useEffect(() => {
    if (list.length && list[index]?.id !== id && index === 0 && initial > 0) setIndex(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.length]);

  useEffect(() => {
    pager.current?.scrollToOffset({ offset: index * width, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  useEffect(() => {
    return () => {
      ScreenOrientation.unlockAsync().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (SCREENSHOT_MODE || !controls || !playing || ptzOpen || talking) return;
    const timer = setTimeout(() => setControls(false), 4500);
    return () => clearTimeout(timer);
  }, [controls, playing, ptzOpen, talking, index]);

  const onModeChange = useCallback((m: StageMode) => setMode(m), []);
  const onPlaying = useCallback((p: boolean) => setPlaying(p), []);

  const goTo = (i: number) => {
    if (i === index) return;
    Haptics.selectionAsync().catch(() => undefined);
    setIndex(i);
    setMode(defaultMode);
    setPlaying(false);
    setPtzOpen(false);
    setZoomed(false);
    setControls(true);
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const rotate = async () => {
    const next = landscape ? 'portrait' : 'landscape';
    setLocked(next);
    await ScreenOrientation.lockAsync(next === 'landscape' ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => undefined);
  };

  const snapshot = () => {
    if (!camera) return;
    flash.value = withSequence(withTiming(0.85, { duration: 60 }), withTiming(0, { duration: 260 }));
    saveSnapshot(api, camera);
  };

  const startTalk = async () => {
    if (!camera) return;
    if (mode !== 'lowLatency') {
      setMode('lowLatency');
      toast(t('live.talkSwitch'), 'info', 'mic');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
    setTalking(true);
    setMuted(false);
    const ok = await stage.current?.talk(true);
    if (!ok) {
      setTalking(false);
      toast(t('live.micDenied'), 'bad', 'mic');
    }
  };

  const stopTalk = () => {
    if (!talking) return;
    setTalking(false);
    stage.current?.talk(false);
  };

  const more = () => {
    if (!camera) return;
    showActions({
      title: camera.name,
      actions: [
        { label: t('live.modeLowLatency'), icon: 'bolt', selected: mode === 'lowLatency', onPress: () => setMode('lowLatency') },
        { label: t('live.modeHls'), icon: 'live', selected: mode === 'hls', onPress: () => setMode('hls') },
        ...(mode === 'hls' && playing ? [{ label: t('live.pip'), icon: 'pip' as const, onPress: () => stage.current?.pip() }] : []),
        { label: landscape ? t('live.portrait') : t('live.landscape'), icon: 'rotate', onPress: rotate },
        { label: t('live.shareSnapshot'), icon: 'share', onPress: () => shareSnapshot(api, camera) },
        ...(locked ? [{ label: t('live.unlockRotation'), icon: 'rotate' as const, onPress: () => {
          setLocked(null);
          ScreenOrientation.unlockAsync().catch(() => undefined);
        } }] : []),
      ],
    });
  };

  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

  if (cameras && !camera) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.title}>{t('live.notFound')}</Text>
        <Button title={t('common.close')} variant="ink" compact onPress={close} />
      </View>
    );
  }

  const padL = Math.max(insets.left, space.md);
  const padR = Math.max(insets.right, space.md);
  const ptz = camera?.capabilities.ptz;
  const talk = camera?.capabilities.twoWayAudio;

  return (
    <View style={styles.root}>
      <StatusBar hidden={landscape || !controls} style="light" animated />
      <FlatList
        ref={pager}
        data={list}
        horizontal
        pagingEnabled
        scrollEnabled={!zoomed && !ptzOpen && !talking}
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={initial}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        keyExtractor={(c) => c.id}
        extraData={`${index}-${mode}-${quality}-${muted}-${width}-${height}`}
        onMomentumScrollEnd={(e) => goTo(Math.round(e.nativeEvent.contentOffset.x / width))}
        windowSize={3}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        renderItem={({ item, index: i }) =>
          i === index ? (
            <Zoomable width={width} height={height} onZoomChange={setZoomed} onTap={() => setControls((v) => !v)}>
              <LiveStage
                ref={stage}
                camera={item}
                api={api}
                mode={mode}
                quality={item.capabilities.substream ? quality : 'hd'}
                muted={muted}
                width={width}
                height={height}
                autoFallback={liveMode === 'auto'}
                onModeChange={onModeChange}
                onPlaying={onPlaying}
                onTalk={(s, err) => {
                  if (s === 'error') {
                    setTalking(false);
                    toast(err === 'unsupported' ? t('live.talkUnsupported') : t('live.talkFailed'), 'bad', 'mic');
                  }
                }}
              />
            </Zoomable>
          ) : (
            <View style={{ width, height, backgroundColor: '#000' }}>
              {item.status.online ? <LiveSnapshot uri={api.snapshotUrl(item.id, 960)} intervalMs={0} style={StyleSheet.absoluteFill} contentFit="contain" /> : null}
            </View>
          )
        }
      />

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff' }, flashStyle]} />

      {controls && camera ? (
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(220)} style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <Shade position="top" height={insets.top + 110} />
          <Shade position="bottom" height={insets.bottom + (ptzOpen ? 320 : 160)} />
          <View style={{ paddingTop: landscape ? space.md : insets.top + space.xs, paddingLeft: padL, paddingRight: padR }}>
            <TopBar camera={camera} index={index} count={list.length} mode={mode} quality={quality} playing={playing} onClose={close} onMore={more} />
          </View>
          <View style={{ flex: 1 }} pointerEvents="box-none" />
          {ptzOpen && ptz ? (
            <Animated.View entering={FadeIn} style={{ marginBottom: space.lg }}>
              <PtzPad api={api} camera={camera} />
            </Animated.View>
          ) : null}
          <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, space.lg), paddingLeft: padL, paddingRight: padR }]} pointerEvents="box-none">
            {camera.capabilities.audio || talk ? (
              <GlassButton icon={muted ? 'speakerOff' : 'speaker'} label={muted ? t('live.unmute') : t('live.mute')} onPress={() => setMuted((m) => !m)} showLabel={!landscape} />
            ) : null}
            {camera.capabilities.substream ? (
              <GlassButton icon="live" badge={quality === 'hd' ? 'HD' : 'SD'} label={t('live.quality')} onPress={() => setQuality((q) => (q === 'hd' ? 'sd' : 'hd'))} showLabel={!landscape} />
            ) : null}
            <GlassButton icon="snapshot" label={t('live.snapshot')} onPress={snapshot} showLabel={!landscape} disabled={!camera.status.online} />
            {talk ? (
              <GlassButton icon="mic" label={talking ? t('live.talking') : t('live.talk')} onPressIn={startTalk} onPressOut={stopTalk} active={talking} activeColor="#FF5A5F" size={talking ? 60 : 48} showLabel={!landscape} />
            ) : null}
            {ptz ? <GlassButton icon="ptz" label={t('live.ptz')} onPress={() => setPtzOpen((v) => !v)} active={ptzOpen} showLabel={!landscape} /> : null}
            <GlassButton icon="playback" label={t('live.playback')} onPress={() => router.push(`/replay/${camera.id}`)} showLabel={!landscape} />
          </View>
        </Animated.View>
      ) : null}
      {!controls && zoomed ? (
        <View style={[styles.zoomHint, { top: insets.top + space.sm }]} pointerEvents="none">
          <Icon name="zoomIn" size={12} color="#fff" />
          <Text style={styles.metaText}>{t('live.zoomed')}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', gap: space.lg },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  titleBlock: { flex: 1, gap: 4, paddingHorizontal: space.xs },
  title: { color: '#fff', fontFamily: fonts.semibold, fontSize: 17 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaText: { color: onVideo.textSecondary, fontFamily: fonts.medium, fontSize: 12, fontVariant: ['tabular-nums'] },
  bottomBar: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', gap: Platform.OS === 'ios' ? space.md : space.sm, flexWrap: 'wrap' },
  zoomHint: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 26, borderRadius: 13, backgroundColor: onVideo.glass },
});
