import type { CameraRecord } from "./cameras.ts";
import { subStreamName } from "./cameras.ts";
import type { Go2rtc } from "./go2rtc.ts";
import { Supervisor } from "./proc.ts";
import { logger } from "./log.ts";

const log = logger("motion");

export function sensitivityToThreshold(s: number): number {
  const c = Math.min(10, Math.max(1, Math.round(s)));
  return Math.round(0.1 * Math.pow(0.7, c - 1) * 10000) / 10000;
}

export function parseSceneScore(line: string): number | undefined {
  const m = line.match(/lavfi\.scene_score=([0-9.eE+-]+)/);
  if (!m) return undefined;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : undefined;
}

export type TrackerEvent =
  | { type: "start"; at: number; score: number }
  | { type: "update"; at: number; score: number }
  | { type: "end"; start: number; end: number; peak: number };

export type TrackerOptions = { threshold: number; quietMs: number; maxEventMs?: number; confirmMs?: number; confirmHits?: number };

export class MotionTracker {
  private active?: { start: number; last: number; peak: number };
  private hits: number[] = [];

  constructor(private o: TrackerOptions) {}

  get inEvent(): boolean {
    return !!this.active;
  }

  feed(at: number, score: number): TrackerEvent[] {
    const out: TrackerEvent[] = [...this.tick(at)];
    if (score < this.o.threshold) return out;
    if (this.active) {
      this.active.last = at;
      if (score > this.active.peak) {
        this.active.peak = score;
        out.push({ type: "update", at, score });
      }
      if (this.o.maxEventMs && at - this.active.start >= this.o.maxEventMs) {
        out.push({ type: "end", start: this.active.start, end: at, peak: this.active.peak });
        this.active = undefined;
        this.hits = [];
      }
      return out;
    }
    const confirmMs = this.o.confirmMs ?? 2000;
    const need = this.o.confirmHits ?? 2;
    this.hits = this.hits.filter((t) => at - t <= confirmMs);
    this.hits.push(at);
    if (this.hits.length >= need) {
      const start = this.hits[0]!;
      this.active = { start, last: at, peak: score };
      this.hits = [];
      out.push({ type: "start", at: start, score });
    }
    return out;
  }

  tick(now: number): TrackerEvent[] {
    if (this.active && now - this.active.last > this.o.quietMs) {
      const ev: TrackerEvent = { type: "end", start: this.active.start, end: this.active.last, peak: this.active.peak };
      this.active = undefined;
      return [ev];
    }
    return [];
  }

  flush(): TrackerEvent[] {
    if (!this.active) return [];
    const ev: TrackerEvent = { type: "end", start: this.active.start, end: this.active.last, peak: this.active.peak };
    this.active = undefined;
    return [ev];
  }
}

export function shouldKeepSegment(
  seg: { start: number; end: number },
  events: { start: number; end: number | null }[],
  preMs: number,
  postMs: number,
  now: number,
): boolean {
  return events.some((e) => e.start - preMs < seg.end && (e.end ?? now) + postMs > seg.start);
}

export function segmentDecidable(seg: { end: number }, preMs: number, now: number, hasOpenEvent: boolean): boolean {
  return !hasOpenEvent && now > seg.end + preMs + 2000;
}

export function buildMotionArgs(ffmpeg: string, input: string, keyframesOnly: boolean): string[] {
  const args = [ffmpeg, "-hide_banner", "-nostats", "-nostdin", "-loglevel", "info", "-threads", "1"];
  if (keyframesOnly) args.push("-skip_frame", "nokey");
  if (input.startsWith("rtsp")) args.push("-rtsp_transport", "tcp", "-timeout", "15000000");
  args.push("-an", "-i", input, "-vf", `fps=2,scale=320:-2,select=gte(scene\\,0),metadata=print`, "-an", "-f", "null", "-");
  return args;
}

export type MotionCallbacks = {
  onStart: (cam: CameraRecord, at: number, score: number) => void;
  onUpdate: (cam: CameraRecord, score: number) => void;
  onEnd: (cam: CameraRecord, start: number, end: number, peak: number) => void;
};

type Det = { sup: Supervisor; tracker: MotionTracker; key: string; cam: CameraRecord };

export class MotionDetector {
  private dets = new Map<string, Det>();
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private ffmpeg: string | undefined,
    private go2rtc: Go2rtc,
    private cb: MotionCallbacks,
    private opts: { postMotionSec: () => number; keyframesOnly: boolean },
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      const now = Date.now();
      for (const d of this.dets.values()) for (const ev of d.tracker.tick(now)) this.dispatch(d, ev);
    }, 1000);
  }

  active(cameraId: string): boolean {
    return !!this.dets.get(cameraId)?.tracker.inEvent;
  }

  private dispatch(d: Det, ev: TrackerEvent) {
    if (ev.type === "start") this.cb.onStart(d.cam, ev.at, ev.score);
    else if (ev.type === "update") this.cb.onUpdate(d.cam, ev.score);
    else this.cb.onEnd(d.cam, ev.start, ev.end, ev.peak);
  }

  sync(cams: CameraRecord[], goReady: boolean): void {
    const wanted = new Map<string, CameraRecord>();
    if (this.ffmpeg && goReady) for (const c of cams) if (c.enabled && (c.motionEnabled || c.recordingMode === "motion")) wanted.set(c.id, c);
    for (const [id, d] of this.dets) {
      const c = wanted.get(id);
      if (!c || this.keyOf(c) !== d.key) {
        this.dets.delete(id);
        for (const ev of d.tracker.flush()) this.dispatch(d, ev);
        void d.sup.stop();
      }
    }
    for (const [id, c] of wanted) {
      const d = this.dets.get(id);
      if (d) d.cam = c;
      else this.startCamera(c);
    }
  }

  private keyOf(c: CameraRecord): string {
    return JSON.stringify([c.streamKey, c.subUrl, c.sensitivity, this.opts.postMotionSec()]);
  }

  private startCamera(cam: CameraRecord) {
    const tracker = new MotionTracker({
      threshold: sensitivityToThreshold(cam.sensitivity),
      quietMs: Math.max(3, this.opts.postMotionSec()) * 1000,
      maxEventMs: 5 * 60_000,
    });
    let startedAt = 0;
    const det: Det = {
      cam,
      tracker,
      key: this.keyOf(cam),
      sup: new Supervisor(`motion:${cam.id}`, {
        command: () => {
          const stream = subStreamName(det.cam) ?? det.cam.streamKey;
          return { cmd: buildMotionArgs(this.ffmpeg!, this.go2rtc.rtspUrl(stream, "video"), this.opts.keyframesOnly) };
        },
        onStart: () => {
          startedAt = Date.now();
        },
        onStderr: (line) => {
          const score = parseSceneScore(line);
          if (score === undefined || Date.now() - startedAt < 5000) return;
          for (const ev of tracker.feed(Date.now(), score)) this.dispatch(det, ev);
        },
        onExit: () => {
          for (const ev of tracker.flush()) this.dispatch(det, ev);
        },
        minBackoffMs: 5000,
        maxBackoffMs: 120_000,
      }),
    };
    this.dets.set(cam.id, det);
    det.sup.start();
    log.info(`motion detection on ${cam.name} (threshold ${sensitivityToThreshold(cam.sensitivity)})`);
  }

  async stopAll(): Promise<void> {
    clearInterval(this.timer);
    const all = [...this.dets.values()];
    this.dets.clear();
    for (const d of all) for (const ev of d.tracker.flush()) this.dispatch(d, ev);
    await Promise.all(all.map((d) => d.sup.stop()));
  }
}
