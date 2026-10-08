import { useEventListener } from 'expo';
import { useVideoPlayer, type VideoPlayer } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';

import { resolveSeek, type Span } from './timeline';

type Options = { urlFor: (recordingId: string) => string; muted: boolean; rate: number };

export function useSegmentPlayer(spans: Span[], { urlFor, muted, rate }: Options) {
  const setup = (p: VideoPlayer) => {
    p.timeUpdateEventInterval = 0.25;
    p.loop = false;
    p.muted = muted;
    p.allowsExternalPlayback = true;
  };
  const a = useVideoPlayer(null, setup);
  const b = useVideoPlayer(null, setup);
  const players = [a, b] as const;
  const [active, setActive] = useState<0 | 1>(0);
  const loaded = useRef<[number, number]>([-1, -1]);
  const loadedIds = useRef<[string | null, string | null]>([null, null]);
  const activeRef = useRef<0 | 1>(0);
  const spansRef = useRef(spans);
  const [time, setTime] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wantPlay = useRef(true);
  const seq = useRef(0);

  useEffect(() => {
    spansRef.current = spans;
    for (const i of [0, 1] as const) {
      const id = loadedIds.current[i];
      loaded.current[i] = id ? spans.findIndex((s) => s.recordingId === id) : -1;
    }
  }, [spans]);

  useEffect(() => {
    a.muted = muted;
    b.muted = muted;
  }, [a, b, muted]);

  useEffect(() => {
    a.playbackRate = rate;
    b.playbackRate = rate;
  }, [a, b, rate]);

  const load = async (slot: 0 | 1, index: number) => {
    const span = spansRef.current[index];
    if (!span) return false;
    if (loadedIds.current[slot] === span.recordingId) return true;
    await players[slot].replaceAsync({ uri: urlFor(span.recordingId), contentType: 'progressive' });
    loaded.current[slot] = index;
    loadedIds.current[slot] = span.recordingId;
    return true;
  };

  const preloadNext = async () => {
    const cur = activeRef.current;
    const other = (1 - cur) as 0 | 1;
    const next = loaded.current[cur] + 1;
    if (!spansRef.current[next] || loaded.current[other] === next) return;
    try {
      players[other].pause();
      await load(other, next);
      players[other].currentTime = 0;
    } catch {}
  };

  const seek = useCallback(
    async (t: number, opts: { play?: boolean } = {}) => {
      const s = spansRef.current;
      const target = resolveSeek(s, t, 'forward') ?? resolveSeek(s, t, 'nearest');
      if (!target) return null;
      const my = ++seq.current;
      if (opts.play !== undefined) wantPlay.current = opts.play;
      setTime(target.time);
      setError(null);
      let slot = activeRef.current;
      const other = (1 - slot) as 0 | 1;
      if (loaded.current[slot] !== target.index && loaded.current[other] === target.index) {
        players[slot].pause();
        slot = other;
        activeRef.current = slot;
        setActive(slot);
      }
      try {
        setBuffering(true);
        await load(slot, target.index);
        if (my !== seq.current) return target;
        const p = players[slot];
        p.currentTime = target.offsetSec;
        p.playbackRate = rate;
        if (wantPlay.current) p.play();
        else p.pause();
        players[(1 - slot) as 0 | 1].pause();
        preloadNext();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (my === seq.current) setBuffering(false);
      }
      return target;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [a, b, rate, urlFor],
  );

  const advance = (from: 0 | 1) => {
    if (from !== activeRef.current) return;
    const next = loaded.current[from] + 1;
    const s = spansRef.current[next];
    if (!s) {
      setPlaying(false);
      wantPlay.current = false;
      return;
    }
    const other = (1 - from) as 0 | 1;
    if (loaded.current[other] === next) {
      const p = players[other];
      p.currentTime = 0;
      p.playbackRate = rate;
      p.muted = muted;
      p.play();
      activeRef.current = other;
      setActive(other);
      setTime(s.start);
      setTimeout(preloadNext, 500);
    } else {
      seek(s.start);
    }
  };

  const handlers = {
    time: (slot: 0 | 1, currentTime: number) => {
      if (slot !== activeRef.current) return;
      const span = spansRef.current[loaded.current[slot]];
      if (span) setTime(span.start + currentTime * 1000);
    },
    end: (slot: 0 | 1) => advance(slot),
    playing: (slot: 0 | 1, isPlaying: boolean) => {
      if (slot === activeRef.current) setPlaying(isPlaying);
    },
    status: (slot: 0 | 1, status: string, message?: string) => {
      if (slot !== activeRef.current) return;
      setBuffering(status === 'loading');
      if (status === 'error') setError(message ?? 'error');
    },
  };
  useSlotEvents(a, 0, handlers);
  useSlotEvents(b, 1, handlers);

  const toggle = () => {
    const p = players[activeRef.current];
    if (p.playing) {
      wantPlay.current = false;
      p.pause();
    } else {
      wantPlay.current = true;
      if (loaded.current[activeRef.current] < 0 && time !== null) seek(time, { play: true });
      else p.play();
    }
  };

  const pause = () => {
    wantPlay.current = false;
    players[activeRef.current].pause();
  };

  return { players, active, time, playing, buffering, error, seek, toggle, pause, activePlayer: players[active] };
}

type Handlers = {
  time: (slot: 0 | 1, t: number) => void;
  end: (slot: 0 | 1) => void;
  playing: (slot: 0 | 1, p: boolean) => void;
  status: (slot: 0 | 1, status: string, message?: string) => void;
};

function useSlotEvents(player: VideoPlayer, slot: 0 | 1, h: Handlers) {
  useEventListener(player, 'timeUpdate', ({ currentTime }) => h.time(slot, currentTime));
  useEventListener(player, 'playToEnd', () => h.end(slot));
  useEventListener(player, 'playingChange', ({ isPlaying }) => h.playing(slot, isPlaying));
  useEventListener(player, 'statusChange', ({ status, error }) => h.status(slot, status, error?.message));
}
