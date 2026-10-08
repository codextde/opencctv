import { describe, expect, test } from "bun:test";
import { MotionTracker, parseSceneScore, segmentDecidable, sensitivityToThreshold, shouldKeepSegment, buildMotionArgs } from "../src/motion.ts";

describe("motion", () => {
  test("sensitivity maps to decreasing thresholds", () => {
    let prev = Infinity;
    for (let s = 1; s <= 10; s++) {
      const t = sensitivityToThreshold(s);
      expect(t).toBeLessThan(prev);
      prev = t;
    }
    expect(sensitivityToThreshold(0)).toBe(sensitivityToThreshold(1));
  });
  test("parses ffmpeg metadata lines", () => {
    expect(parseSceneScore("[Parsed_metadata_3 @ 0x1] lavfi.scene_score=0.123456")).toBeCloseTo(0.123456);
    expect(parseSceneScore("frame:1 pts:2")).toBeUndefined();
  });
  test("tracker needs confirmation, ends after quiet period", () => {
    const t = new MotionTracker({ threshold: 0.05, quietMs: 3000 });
    expect(t.feed(0, 0.2)).toEqual([]);
    const ev = t.feed(500, 0.3);
    expect(ev).toEqual([{ type: "start", at: 0, score: 0.3 }]);
    expect(t.feed(1000, 0.5)).toEqual([{ type: "update", at: 1000, score: 0.5 }]);
    expect(t.feed(2000, 0.01)).toEqual([]);
    expect(t.tick(3500)).toEqual([]);
    expect(t.tick(4500)).toEqual([{ type: "end", start: 0, end: 1000, peak: 0.5 }]);
    expect(t.inEvent).toBe(false);
  });
  test("isolated spikes are ignored", () => {
    const t = new MotionTracker({ threshold: 0.05, quietMs: 3000 });
    expect(t.feed(0, 0.9)).toEqual([]);
    expect(t.feed(5000, 0.9)).toEqual([]);
    expect(t.inEvent).toBe(false);
  });
  test("long events are split", () => {
    const t = new MotionTracker({ threshold: 0.05, quietMs: 3000, maxEventMs: 10_000 });
    const all = [];
    for (let ms = 0; ms <= 12_000; ms += 500) all.push(...t.feed(ms, 0.2));
    expect(all.filter((e) => e.type === "end").length).toBe(1);
    expect(all.filter((e) => e.type === "start").length).toBe(2);
  });
  test("motion-only segment selection with pre/post padding", () => {
    const seg = { start: 100_000, end: 400_000 };
    expect(shouldKeepSegment(seg, [], 5000, 10_000, 500_000)).toBe(false);
    expect(shouldKeepSegment(seg, [{ start: 200_000, end: 210_000 }], 5000, 10_000, 500_000)).toBe(true);
    expect(shouldKeepSegment(seg, [{ start: 403_000, end: 420_000 }], 5000, 10_000, 500_000)).toBe(true);
    expect(shouldKeepSegment(seg, [{ start: 80_000, end: 95_000 }], 5000, 10_000, 500_000)).toBe(true);
    expect(shouldKeepSegment(seg, [{ start: 50_000, end: 60_000 }], 5000, 10_000, 500_000)).toBe(false);
    expect(shouldKeepSegment(seg, [{ start: 30_000, end: null }], 5000, 10_000, 500_000)).toBe(true);
    expect(segmentDecidable(seg, 5000, 406_000, false)).toBe(false);
    expect(segmentDecidable(seg, 5000, 408_000, false)).toBe(true);
    expect(segmentDecidable(seg, 5000, 408_000, true)).toBe(false);
  });
  test("detector command samples at 2 fps and prints scene scores", () => {
    const a = buildMotionArgs("ffmpeg", "rtsp://127.0.0.1/c?video", false).join(" ");
    expect(a).toContain("fps=2,scale=320:-2,select=gte(scene\\,0),metadata=print");
    expect(buildMotionArgs("ffmpeg", "x", true)).toContain("nokey");
  });
});
