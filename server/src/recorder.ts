import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { CameraRecord } from "./cameras.ts";
import { subStreamName } from "./cameras.ts";
import type { Go2rtc } from "./go2rtc.ts";
import type { Recordings, RecordingRow } from "./recordings.ts";
import type { Binaries } from "./deps.ts";
import { Supervisor } from "./proc.ts";
import { logger, errMsg } from "./log.ts";
import { makeThumbnail, parseSegmentPath, probeDuration, utcDay } from "./media.ts";

const log = logger("recorder");

export type RecorderDeps = {
  recordingsDir: string;
  thumbsDir: string;
  bins: Binaries;
  go2rtc: Go2rtc;
  recordings: Recordings;
  segmentSeconds: () => number;
  codecOf: (cameraId: string) => string | undefined;
  onSegment: (rec: RecordingRow, cam: CameraRecord) => void;
  onStatus: (cameraId: string) => void;
  getCamera: (cameraId: string) => CameraRecord | undefined;
};

type Entry = { sup: Supervisor; key: string; cam: CameraRecord; lastSegmentAt: number; lastError?: string };

export function buildRecordArgs(o: {
  ffmpeg: string;
  input: string;
  segmentSeconds: number;
  outPattern: string;
  hevc: boolean;
  audio: boolean;
}): string[] {
  const args = [o.ffmpeg, "-hide_banner", "-loglevel", "warning", "-nostats", "-nostdin"];
  if (o.input.startsWith("rtsp")) args.push("-rtsp_transport", "tcp", "-timeout", "15000000");
  args.push("-fflags", "+genpts+discardcorrupt", "-i", o.input, "-map", "0:v:0");
  if (o.audio) args.push("-map", "0:a:0?", "-c:a", "aac", "-b:a", "64k", "-ac", "1");
  else args.push("-an");
  args.push("-c:v", "copy");
  if (o.hevc) args.push("-tag:v", "hvc1");
  args.push(
    "-f", "segment",
    "-segment_time", String(o.segmentSeconds),
    "-segment_format", "mp4",
    "-segment_format_options", "movflags=+faststart",
    "-reset_timestamps", "1",
    "-strftime", "1",
    "-segment_list", "pipe:1",
    "-segment_list_type", "flat",
    o.outPattern,
  );
  return args;
}

export class Recorder {
  private entries = new Map<string, Entry>();
  private scanning = new Map<string, Promise<void>>();
  private dirTimer?: ReturnType<typeof setInterval>;
  private scanTimer?: ReturnType<typeof setInterval>;

  constructor(private d: RecorderDeps) {}

  start(): void {
    this.dirTimer = setInterval(() => {
      for (const e of this.entries.values()) this.ensureDirs(e.cam.id);
    }, 10 * 60_000);
    this.scanTimer = setInterval(() => {
      for (const e of this.entries.values()) void this.scan(e.cam.id);
    }, 20_000);
  }

  isRecording(cameraId: string): boolean {
    const e = this.entries.get(cameraId);
    return !!e && e.sup.running;
  }

  errorOf(cameraId: string): string | undefined {
    const e = this.entries.get(cameraId);
    return e && !e.sup.running ? e.lastError : undefined;
  }

  camDir(cameraId: string): string {
    return join(this.d.recordingsDir, cameraId);
  }

  private ensureDirs(cameraId: string) {
    const now = Date.now();
    for (const t of [now, now + 86400_000]) mkdirSync(join(this.camDir(cameraId), utcDay(t)), { recursive: true });
  }

  sync(cams: CameraRecord[], goReady: boolean): void {
    const wanted = new Map<string, CameraRecord>();
    if (this.d.bins.ffmpeg && goReady) for (const c of cams) if (c.enabled && c.recordingMode !== "off") wanted.set(c.id, c);
    for (const [id, e] of this.entries) {
      const c = wanted.get(id);
      if (!c || this.keyOf(c) !== e.key) {
        this.entries.delete(id);
        void e.sup.stop().then(() => this.scan(id, true));
      }
    }
    for (const [id, c] of wanted) {
      const existing = this.entries.get(id);
      if (existing) {
        existing.cam = c;
        continue;
      }
      this.startCamera(c);
    }
  }

  private keyOf(c: CameraRecord): string {
    return JSON.stringify([c.streamKey, c.useSubstream && !!c.subUrl, this.d.segmentSeconds(), this.d.codecOf(c.id) === "hevc", c.url, c.subUrl]);
  }

  private startCamera(cam: CameraRecord) {
    const ffmpeg = this.d.bins.ffmpeg!;
    const entry: Entry = {
      cam,
      key: this.keyOf(cam),
      lastSegmentAt: Date.now(),
      sup: new Supervisor(`rec:${cam.id}`, {
        command: () => {
          this.ensureDirs(cam.id);
          const c = entry.cam;
          const stream = c.useSubstream ? subStreamName(c) ?? c.streamKey : c.streamKey;
          return {
            cmd: buildRecordArgs({
              ffmpeg,
              input: this.d.go2rtc.rtspUrl(stream, "video&audio"),
              segmentSeconds: this.d.segmentSeconds(),
              outPattern: join(this.camDir(c.id), "%Y-%m-%d", "%H%M%S.mp4"),
              hevc: this.d.codecOf(c.id) === "hevc",
              audio: true,
            }),
            env: { TZ: "UTC0" },
          };
        },
        onStdout: () => void this.scan(cam.id),
        onStderr: (line) => {
          entry.lastError = line.slice(0, 300);
          entry.sup.log.debug(line);
        },
        onStart: () => this.d.onStatus(cam.id),
        onExit: () => {
          void this.scan(cam.id, true);
          this.d.onStatus(cam.id);
        },
        minBackoffMs: 3000,
        maxBackoffMs: 60_000,
      }),
    };
    this.entries.set(cam.id, entry);
    entry.sup.start();
    log.info(`recording ${cam.name} (${cam.id}) mode=${cam.recordingMode}`);
  }

  async scan(cameraId: string, includeNewest = false): Promise<void> {
    const prev = this.scanning.get(cameraId) ?? Promise.resolve();
    const next = prev.then(() => this.doScan(cameraId, includeNewest));
    this.scanning.set(cameraId, next);
    await next;
    if (this.scanning.get(cameraId) === next) this.scanning.delete(cameraId);
  }

  private async doScan(cameraId: string, includeNewest: boolean): Promise<void> {
    const entry = this.entries.get(cameraId);
    try {
      const dir = this.camDir(cameraId);
      if (!existsSync(dir)) return;
      const days = readdirSync(dir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().slice(-3);
      const files: string[] = [];
      for (const day of days) {
        for (const f of readdirSync(join(dir, day))) if (/^\d{6}\.mp4$/.test(f)) files.push(`${day}/${f}`);
      }
      files.sort();
      const active = !includeNewest && entry?.sup.running;
      const finished = active ? files.slice(0, -1) : files;
      for (const rel of finished) {
        const relPath = `${cameraId}/${rel}`;
        if (this.d.recordings.hasPath(relPath)) continue;
        await this.index(cameraId, relPath);
      }
    } catch (e) {
      log.warn(`scan ${cameraId}: ${errMsg(e)}`);
    }
  }

  private async index(cameraId: string, relPath: string): Promise<void> {
    const abs = join(this.d.recordingsDir, relPath);
    const start = parseSegmentPath(relPath);
    if (start === undefined) return;
    let st;
    try {
      st = statSync(abs);
    } catch {
      return;
    }
    let duration = await probeDuration(this.d.bins.ffprobe, abs);
    if (!duration) {
      if (this.d.bins.ffprobe || st.size < 1024) {
        if (Date.now() - st.mtimeMs > 30_000 || st.size < 1024) {
          log.warn(`removing unreadable segment ${relPath}`);
          try {
            unlinkSync(abs);
          } catch {}
        }
        return;
      }
      duration = Math.max(1, (st.mtimeMs - start) / 1000);
    }
    const cam = this.entries.get(cameraId)?.cam ?? this.d.getCamera(cameraId);
    const rec = this.d.recordings.insert({
      camera_id: cameraId,
      start_ms: start,
      end_ms: start + Math.round(duration * 1000),
      duration,
      size: st.size,
      path: relPath,
      thumb_path: null,
      state: cam?.recordingMode === "motion" ? "pending" : "kept",
    });
    const thumbRel = `${cameraId}/${rec.id}.jpg`;
    mkdirSync(join(this.d.thumbsDir, cameraId), { recursive: true });
    if (await makeThumbnail(this.d.bins.ffmpeg, abs, join(this.d.thumbsDir, thumbRel), Math.min(1, duration / 2))) {
      rec.thumb_path = thumbRel;
      this.d.recordings.setThumb(rec.id, thumbRel);
    }
    const e = this.entries.get(cameraId);
    if (e) e.lastSegmentAt = Date.now();
    if (cam) this.d.onSegment(rec, cam);
  }

  async stopAll(): Promise<void> {
    clearInterval(this.dirTimer);
    clearInterval(this.scanTimer);
    const all = [...this.entries.entries()];
    this.entries.clear();
    await Promise.all(all.map(([id, e]) => e.sup.stop().then(() => this.scan(id, true))));
  }
}
