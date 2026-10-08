/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { clipWindow, dayBounds, dayKey, formatClock, formatDuration, hourTicks, mergeSpans, resolveSeek, shiftDay, spanIndexAt, timeToX, toSpans, xToTime } from './timeline';

const at = (h: number, m = 0, s = 0) => new Date(2026, 9, 8, h, m, s).getTime();
const iso = (t: number) => new Date(t).toISOString();

const spans = toSpans([
  { start: iso(at(10, 1)), end: iso(at(10, 2)), recordingId: 'b' },
  { start: iso(at(10, 0)), end: iso(at(10, 1)), recordingId: 'a' },
  { start: iso(at(12, 0)), end: iso(at(12, 5)), recordingId: 'c' },
  { start: 'bad', end: iso(at(13)), recordingId: 'x' },
]);

describe('days', () => {
  test('dayKey and shiftDay', () => {
    expect(dayKey(at(23, 59))).toBe('2026-10-08');
    expect(shiftDay('2026-10-08', 1)).toBe('2026-10-09');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
  });
  test('dayBounds covers local midnight to midnight', () => {
    const b = dayBounds('2026-10-08');
    expect(b.start).toBe(at(0));
    expect(b.end - b.start).toBeGreaterThanOrEqual(23 * 3600000);
  });
  test('hourTicks returns each local hour', () => {
    const ticks = hourTicks('2026-10-08');
    expect(ticks[0].hour).toBe(0);
    expect(ticks.length).toBeGreaterThanOrEqual(23);
    expect(ticks.length).toBeLessThanOrEqual(25);
  });
});

describe('spans', () => {
  test('sorted, invalid dropped', () => {
    expect(spans.map((s) => s.recordingId)).toEqual(['a', 'b', 'c']);
  });
  test('merge adjacent', () => {
    expect(mergeSpans(spans)).toEqual([
      { start: at(10, 0), end: at(10, 2) },
      { start: at(12, 0), end: at(12, 5) },
    ]);
  });
  test('index lookup', () => {
    expect(spanIndexAt(spans, at(10, 0, 30))).toBe(0);
    expect(spanIndexAt(spans, at(10, 1))).toBe(1);
    expect(spanIndexAt(spans, at(11))).toBe(-1);
  });
});

describe('resolveSeek', () => {
  test('inside a span gives offset', () => {
    expect(resolveSeek(spans, at(10, 1, 15))).toEqual({ index: 1, offsetSec: 15, time: at(10, 1, 15) });
  });
  test('gap snaps forward', () => {
    expect(resolveSeek(spans, at(11))).toEqual({ index: 2, offsetSec: 0, time: at(12) });
  });
  test('after the end returns null going forward, last frame when nearest', () => {
    expect(resolveSeek(spans, at(15))).toBeNull();
    const r = resolveSeek(spans, at(15), 'nearest');
    expect(r?.index).toBe(2);
    expect(r?.time).toBe(at(12, 5) - 1000);
  });
  test('nearest picks closer side', () => {
    expect(resolveSeek(spans, at(10, 10), 'nearest')?.index).toBe(1);
    expect(resolveSeek(spans, at(11, 55), 'nearest')?.index).toBe(2);
  });
  test('empty', () => {
    expect(resolveSeek([], at(1))).toBeNull();
  });
});

describe('geometry', () => {
  test('x and time round trip', () => {
    const start = at(0);
    expect(timeToX(at(2, 30), start, 100)).toBe(250);
    expect(xToTime(250, start, 100)).toBe(at(2, 30));
  });
  test('clip window stays inside footage', () => {
    expect(clipWindow(at(10, 0, 5), 30, spans)).toEqual({ start: at(10, 0), end: at(10, 0, 30) });
    expect(clipWindow(at(12, 4, 55), 60, spans)).toEqual({ start: at(12, 4), end: at(12, 5) });
    expect(clipWindow(at(10, 1), 20, spans)).toEqual({ start: at(10, 0, 50), end: at(10, 1, 10) });
  });
});

describe('format', () => {
  test('clock', () => {
    expect(formatClock(at(9, 5, 7))).toBe('09:05:07');
    expect(formatClock(at(13, 5, 7), false)).toBe('1:05:07 PM');
    expect(formatClock(at(0, 5), false, false)).toBe('12:05 AM');
  });
  test('duration', () => {
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
});
