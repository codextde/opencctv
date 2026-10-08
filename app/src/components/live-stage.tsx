import type { VideoView } from 'expo-video';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useT } from '@/i18n';
import type { ServerApi } from '@/lib/api';
import type { Camera } from '@/lib/types';
import { fonts, space } from '@/theme';

import { HlsVideo } from './hls-video';
import { Icon } from './icon';
import { LiveSnapshot } from './live-snapshot';
import { Button } from './ui';
import { WebRtcPlayer, type WebPlayerHandle } from './webrtc-player';

export type StageMode = 'lowLatency' | 'hls';

type Props = {
  camera: Camera;
  api: ServerApi;
  mode: StageMode;
  quality: 'hd' | 'sd';
  muted: boolean;
  width: number;
  height: number;
  autoFallback: boolean;
  onModeChange: (mode: StageMode) => void;
  onPlaying?: (playing: boolean, detail?: string) => void;
  onTalk?: (state: 'on' | 'off' | 'error', error?: string) => void;
};

export type StageHandle = { talk: (on: boolean) => Promise<boolean>; pip: () => void; retry: () => void };

const LL_TIMEOUT = 9000;

export const LiveStage = forwardRef<StageHandle, Props>(function LiveStage(
  { camera, api, mode, quality, muted, width, height, autoFallback, onModeChange, onPlaying, onTalk },
  ref,
) {
  const { t } = useT();
  const web = useRef<WebPlayerHandle>(null);
  const video = useRef<VideoView>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [talkMode, setTalkMode] = useState(false);
  const pendingTalk = useRef<boolean | null>(null);
  const online = camera.status.online && camera.enabled;

  useImperativeHandle(ref, () => ({
    talk: async (on) => {
      if (mode !== 'lowLatency') return false;
      if (!talkMode || !playing) {
        pendingTalk.current = on;
        if (on && !talkMode) setTalkMode(true);
        return true;
      }
      pendingTalk.current = null;
      return web.current ? web.current.talk(on) : false;
    },
    pip: () => {
      video.current?.startPictureInPicture().catch(() => undefined);
    },
    retry: () => {
      setFailed(null);
      setAttempt((a) => a + 1);
    },
  }));

  useEffect(() => {
    setPlaying(false);
    setFailed(null);
  }, [mode, quality, camera.id, attempt, talkMode]);

  useEffect(() => {
    setTalkMode(false);
    pendingTalk.current = null;
  }, [camera.id, mode]);

  useEffect(() => {
    onPlaying?.(playing, mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, mode]);

  useEffect(() => {
    if (mode !== 'lowLatency' || playing || !online) return;
    const id = setTimeout(() => {
      if (autoFallback) onModeChange('hls');
      else setFailed(t('live.playFailed'));
    }, LL_TIMEOUT);
    return () => clearTimeout(id);
  }, [mode, playing, online, autoFallback, onModeChange, attempt, t]);

  const key = `${camera.id}-${mode}-${quality}-${attempt}-${talkMode ? 't' : ''}`;

  return (
    <View style={{ width, height, backgroundColor: '#000' }} pointerEvents="box-none">
      {online ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <LiveSnapshot uri={api.snapshotUrl(camera.id, 1280)} intervalMs={playing ? 0 : 2500} style={StyleSheet.absoluteFill} contentFit="contain" />
        </View>
      ) : null}
      {online && !failed ? (
        mode === 'lowLatency' ? (
          <WebRtcPlayer
            key={key}
            ref={web}
            uri={api.playerUrl(camera.id, quality, talkMode ? false : muted, talkMode)}
            muted={muted}
            style={[StyleSheet.absoluteFill, { opacity: playing ? 1 : 0 }]}
            onState={(s) => {
              if (s.state === 'playing') setPlaying(true);
              else if (s.state === 'error') {
                if (autoFallback) onModeChange('hls');
                else setFailed(s.error ?? t('live.playFailed'));
              }
            }}
            onTalk={onTalk}
            onPlaying={() => {
              if (talkMode && pendingTalk.current !== null) {
                const want = pendingTalk.current;
                pendingTalk.current = null;
                web.current?.talk(want);
              }
            }}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, { opacity: playing ? 1 : 0 }]} pointerEvents="none">
            <HlsVideo
              key={key}
              ref={video}
              uri={api.liveHlsUrl(camera.id, quality)}
              muted={muted}
              contentFit="contain"
              pip
              style={StyleSheet.absoluteFill}
              onFirstFrame={() => setPlaying(true)}
              onError={(m) => setFailed(m || t('live.playFailed'))}
            />
          </View>
        )
      ) : null}
      {online && !playing && !failed ? (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator color="#fff" />
        </View>
      ) : null}
      {!online || failed ? (
        <View style={[styles.center, styles.message]} pointerEvents="box-none">
          <Icon name={online ? 'warning' : 'offline'} size={30} color="rgba(255,255,255,0.7)" />
          <Text style={styles.title}>{online ? t('live.playFailed') : camera.enabled ? t('live.cameraOffline') : t('live.cameraDisabled')}</Text>
          {camera.status.error || failed ? (
            <Text style={styles.detail} numberOfLines={3}>
              {online ? failed : camera.status.error}
            </Text>
          ) : null}
          {online ? (
            <Button
              title={t('common.retry')}
              variant="ink"
              compact
              onPress={() => {
                setFailed(null);
                setAttempt((a) => a + 1);
              }}
              style={{ marginTop: space.sm }}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  message: { backgroundColor: 'rgba(0,0,0,0.55)', gap: space.sm, paddingHorizontal: space.xxl },
  title: { color: '#fff', fontFamily: fonts.semibold, fontSize: 16, textAlign: 'center' },
  detail: { color: 'rgba(255,255,255,0.6)', fontFamily: fonts.regular, fontSize: 13, textAlign: 'center' },
});
