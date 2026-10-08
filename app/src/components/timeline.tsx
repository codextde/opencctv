import * as Haptics from 'expo-haptics';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { uses24h } from '@/i18n';
import { clamp, dayBounds, formatHour, hourTicks, mergeSpans, timeToX, xToTime, type Span } from '@/lib/timeline';
import type { MotionEvent } from '@/lib/types';
import { fonts, radius, useColors } from '@/theme';

type Props = {
  day: string;
  spans: Span[];
  events: MotionEvent[];
  time: number | null;
  height?: number;
  dark?: boolean;
  onScrub?: (t: number) => void;
  onSeek: (t: number) => void;
};

const MIN_PX = 48;
const MAX_PX = 3600;

const Track = memo(function Track({ day, spans, events, pxPerHour, height, dark }: { day: string; spans: Span[]; events: MotionEvent[]; pxPerHour: number; height: number; dark: boolean }) {
  const c = useColors();
  const { start, end } = dayBounds(day);
  const width = timeToX(end, start, pxPerHour);
  const merged = useMemo(() => mergeSpans(spans), [spans]);
  const ticks = useMemo(() => hourTicks(day), [day]);
  const h24 = uses24h();
  const labelEvery = pxPerHour < 70 ? 4 : pxPerHour < 120 ? 2 : 1;
  const quarter = pxPerHour >= 360;
  const barTop = 22;
  const barHeight = height - barTop - 12;
  const recColor = dark ? 'rgba(45,212,191,0.55)' : c.accentSoft;
  const recEdge = dark ? '#2DD4BF' : c.accent;
  const tickColor = dark ? 'rgba(255,255,255,0.22)' : c.borderStrong;
  const labelColor = dark ? 'rgba(255,255,255,0.55)' : c.textTertiary;

  return (
    <View style={{ width, height }}>
      <View style={[styles.base, { top: barTop, height: barHeight, backgroundColor: dark ? 'rgba(255,255,255,0.05)' : c.surfaceSunken }]} />
      {merged.map((m) => {
        const left = timeToX(Math.max(m.start, start), start, pxPerHour);
        const w = Math.max(2, timeToX(Math.min(m.end, end), start, pxPerHour) - left);
        return <View key={m.start} style={[styles.range, { left, width: w, top: barTop, height: barHeight, backgroundColor: recColor, borderTopColor: recEdge }]} />;
      })}
      {events.map((e) => {
        const t = Date.parse(e.start);
        if (!(t >= start && t < end)) return null;
        const left = timeToX(t, start, pxPerHour);
        return <View key={e.id} style={[styles.event, { left: left - 1.5, top: barTop + barHeight - 14 }]} />;
      })}
      {ticks.map((tk) => {
        const left = timeToX(tk.t, start, pxPerHour);
        const showLabel = tk.hour % labelEvery === 0;
        return (
          <View key={tk.t} style={[styles.tick, { left }]} pointerEvents="none">
            <View style={{ width: 1, height: showLabel ? 8 : 5, backgroundColor: tickColor }} />
            {showLabel ? <Text style={[styles.tickLabel, { color: labelColor }]}>{formatHour(tk.hour, h24)}</Text> : null}
          </View>
        );
      })}
      {quarter
        ? ticks.flatMap((tk) =>
            [1, 2, 3].map((q) => (
              <View key={`${tk.t}-${q}`} style={[styles.tick, { left: timeToX(tk.t + q * 900000, start, pxPerHour) }]} pointerEvents="none">
                <View style={{ width: 1, height: 4, backgroundColor: tickColor }} />
              </View>
            )),
          )
        : null}
    </View>
  );
});

export function Timeline({ day, spans, events, time, height = 76, dark = false, onScrub, onSeek }: Props) {
  const c = useColors();
  const scroll = useRef<ScrollView>(null);
  const [viewport, setViewport] = useState(0);
  const [pxPerHour, setPxPerHour] = useState(240);
  const pinchBase = useRef(240);
  const dragging = useRef(false);
  const momentum = useRef(false);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastX = useRef(0);
  const { start, end } = dayBounds(day);
  const totalWidth = timeToX(end, start, pxPerHour);

  const xFor = (t: number) => clamp(timeToX(t, start, pxPerHour), 0, totalWidth);

  useEffect(() => {
    if (time === null || dragging.current || momentum.current || !viewport) return;
    const x = xFor(time);
    if (Math.abs(x - lastX.current) < 0.5) return;
    lastX.current = x;
    scroll.current?.scrollTo({ x, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time, viewport, pxPerHour, day]);

  const commit = (x: number) => {
    momentum.current = false;
    dragging.current = false;
    lastX.current = x;
    onSeek(xToTime(clamp(x, 0, totalWidth), start, pxPerHour));
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!dragging.current && !momentum.current) return;
    const x = e.nativeEvent.contentOffset.x;
    onScrub?.(xToTime(clamp(x, 0, totalWidth), start, pxPerHour));
  };

  const zoomTo = (px: number) => {
    const next = clamp(px, MIN_PX, MAX_PX);
    setPxPerHour(next);
  };

  const onPinchStart = () => {
    pinchBase.current = pxPerHour;
    Haptics.selectionAsync().catch(() => undefined);
  };
  const onPinchUpdate = (e: { scale: number }) => zoomTo(pinchBase.current * e.scale);
  const pinch = Gesture.Pinch().runOnJS(true).onStart(onPinchStart).onUpdate(onPinchUpdate);

  return (
    <GestureDetector gesture={pinch}>
      <View
        style={{ height }}
        onLayout={(e: LayoutChangeEvent) => setViewport(e.nativeEvent.layout.width)}
        accessibilityRole="adjustable"
        accessibilityLabel="Timeline">
        {viewport ? (
          <ScrollView
            ref={scroll}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: viewport / 2 }}
            scrollEventThrottle={32}
            decelerationRate="fast"
            onScroll={onScroll}
            onScrollBeginDrag={() => {
              dragging.current = true;
              if (commitTimer.current) clearTimeout(commitTimer.current);
            }}
            onScrollEndDrag={(e) => {
              const x = e.nativeEvent.contentOffset.x;
              const v = Math.abs(e.nativeEvent.velocity?.x ?? 0);
              dragging.current = false;
              if (v < 0.05) commit(x);
              else {
                momentum.current = true;
                commitTimer.current = setTimeout(() => momentum.current && commit(x), 900);
              }
            }}
            onMomentumScrollEnd={(e) => {
              if (commitTimer.current) clearTimeout(commitTimer.current);
              if (momentum.current) commit(e.nativeEvent.contentOffset.x);
            }}>
            <Track day={day} spans={spans} events={events} pxPerHour={pxPerHour} height={height} dark={dark} />
          </ScrollView>
        ) : null}
        <View pointerEvents="none" style={[styles.playhead, { left: viewport / 2 - 1, backgroundColor: dark ? '#fff' : c.text }]}>
          <View style={[styles.playheadKnob, { backgroundColor: dark ? '#fff' : c.text }]} />
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  base: { position: 'absolute', left: 0, right: 0, borderRadius: radius.xs },
  range: { position: 'absolute', borderTopWidth: 2, borderRadius: 2 },
  event: { position: 'absolute', width: 3, height: 10, borderRadius: 1.5, backgroundColor: '#F5B544' },
  tick: { position: 'absolute', top: 0, alignItems: 'flex-start' },
  tickLabel: { fontFamily: fonts.medium, fontSize: 10, marginTop: 1, marginLeft: 3, fontVariant: ['tabular-nums'] },
  playhead: { position: 'absolute', top: 14, bottom: 4, width: 2, borderRadius: 1 },
  playheadKnob: { position: 'absolute', top: -4, left: -3, width: 8, height: 8, borderRadius: 4 },
});
