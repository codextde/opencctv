import type { TimelineRange } from './types';

export type Span = { start: number; end: number; recordingId: string };

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

export function dayKey(t: number | Date): string {
  const d = typeof t === 'number' ? new Date(t) : t;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDay(day: string): { y: number; m: number; d: number } {
  const [y, m, d] = day.split('-').map(Number);
  return { y, m, d };
}

export function dayBounds(day: string): { start: number; end: number } {
  const { y, m, d } = parseDay(day);
  return { start: new Date(y, m - 1, d).getTime(), end: new Date(y, m - 1, d + 1).getTime() };
}

export function shiftDay(day: string, delta: number): string {
  const { y, m, d } = parseDay(day);
  return dayKey(new Date(y, m - 1, d + delta));
}

export function toSpans(ranges: TimelineRange[]): Span[] {
  return ranges
    .map((r) => ({ start: Date.parse(r.start), end: Date.parse(r.end), recordingId: r.recordingId }))
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .sort((a, b) => a.start - b.start);
}

export function mergeSpans(spans: Span[], gapMs = 2000): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s.start - last.end <= gapMs) last.end = Math.max(last.end, s.end);
    else out.push({ start: s.start, end: s.end });
  }
  return out;
}

export function spanIndexAt(spans: Span[], t: number): number {
  let lo = 0;
  let hi = spans.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = spans[mid];
    if (t < s.start) hi = mid - 1;
    else if (t >= s.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

export type SeekTarget = { index: number; offsetSec: number; time: number };

export function resolveSeek(spans: Span[], t: number, direction: 'forward' | 'nearest' = 'forward'): SeekTarget | null {
  if (!spans.length) return null;
  const i = spanIndexAt(spans, t);
  if (i >= 0) return { index: i, offsetSec: (t - spans[i].start) / 1000, time: t };
  const next = spans.findIndex((s) => s.start > t);
  if (direction === 'forward') {
    if (next >= 0) return { index: next, offsetSec: 0, time: spans[next].start };
    return null;
  }
  const prev = next < 0 ? spans.length - 1 : next - 1;
  const dPrev = prev >= 0 ? t - spans[prev].end : Infinity;
  const dNext = next >= 0 ? spans[next].start - t : Infinity;
  if (dNext <= dPrev) return { index: next, offsetSec: 0, time: spans[next].start };
  const s = spans[prev];
  const time = Math.max(s.start, s.end - 1000);
  return { index: prev, offsetSec: (time - s.start) / 1000, time };
}

export function timeToX(t: number, dayStart: number, pxPerHour: number): number {
  return ((t - dayStart) / 3600000) * pxPerHour;
}

export function xToTime(x: number, dayStart: number, pxPerHour: number): number {
  return dayStart + (x / pxPerHour) * 3600000;
}

export function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export function hourTicks(day: string): { t: number; hour: number }[] {
  const { y, m, d } = parseDay(day);
  const out: { t: number; hour: number }[] = [];
  const end = dayBounds(day).end;
  for (let h = 0; h <= 25; h++) {
    const t = new Date(y, m - 1, d, h).getTime();
    if (t >= end) break;
    if (out.length && out[out.length - 1].t === t) continue;
    out.push({ t, hour: new Date(t).getHours() });
  }
  return out;
}

export function clipWindow(t: number, lengthSec: number, spans: Span[]): { start: number; end: number } {
  const half = (lengthSec * 1000) / 2;
  let start = t - half;
  let end = t + half;
  if (spans.length) {
    const first = spans[0].start;
    const last = spans[spans.length - 1].end;
    if (start < first) {
      end += first - start;
      start = first;
    }
    if (end > last) {
      start = Math.max(first, start - (end - last));
      end = last;
    }
  }
  return { start: Math.round(start), end: Math.round(end) };
}

export function formatClock(t: number, use24h = true, seconds = true): string {
  const d = new Date(t);
  const h = d.getHours();
  const mm = pad(d.getMinutes());
  const ss = seconds ? `:${pad(d.getSeconds())}` : '';
  if (use24h) return `${pad(h)}:${mm}${ss}`;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm}${ss} ${h < 12 ? 'AM' : 'PM'}`;
}

export function formatHour(hour: number, use24h = true): string {
  if (use24h) return `${pad(hour)}:00`;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${hour < 12 ? 'AM' : 'PM'}`;
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}:${pad(m)}:${pad(r)}`;
  return `${m}:${pad(r)}`;
}
