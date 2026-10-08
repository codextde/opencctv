import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView, type VideoContentFit, type VideoPlayer } from 'expo-video';
import { forwardRef, useEffect, useRef } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';

type Props = {
  uri: string;
  muted?: boolean;
  contentFit?: VideoContentFit;
  style?: StyleProp<ViewStyle>;
  live?: boolean;
  pip?: boolean;
  onFirstFrame?: () => void;
  onError?: (message: string) => void;
  onPlayer?: (player: VideoPlayer) => void;
};

export const HlsVideo = forwardRef<VideoView, Props>(function HlsVideo(
  { uri, muted = true, contentFit = 'cover', style, live = true, pip = false, onFirstFrame, onError, onPlayer },
  ref,
) {
  const retries = useRef(0);
  const player = useVideoPlayer({ uri, contentType: 'hls' }, (p) => {
    p.muted = muted;
    p.loop = false;
    p.allowsExternalPlayback = true;
    if (live && Platform.OS === 'ios') p.bufferOptions = { preferredForwardBufferDuration: 1, waitsToMinimizeStalling: false };
    p.play();
  });

  useEffect(() => {
    onPlayer?.(player);
  }, [player, onPlayer]);

  useEffect(() => {
    player.muted = muted;
  }, [player, muted]);

  useEventListener(player, 'statusChange', ({ status, error }) => {
    if (status === 'readyToPlay') retries.current = 0;
    if (status !== 'error') return;
    if (retries.current < 3) {
      retries.current++;
      setTimeout(() => {
        try {
          player.replace({ uri, contentType: 'hls' });
          player.play();
        } catch {}
      }, 1500 * retries.current);
      return;
    }
    onError?.(error?.message ?? 'playback error');
  });

  return (
    <VideoView
      ref={ref}
      player={player}
      style={style}
      contentFit={contentFit}
      nativeControls={false}
      allowsVideoFrameAnalysis={false}
      allowsPictureInPicture={pip}
      startsPictureInPictureAutomatically={false}
      onFirstFrameRender={onFirstFrame}
      surfaceType={Platform.OS === 'android' ? 'textureView' : undefined}
    />
  );
});
