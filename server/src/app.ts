import { existsSync, mkdirSync, readFileSync, statfsSync, unlinkSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Server } from "bun";
import { VERSION, type Config, dataPath } from "./config.ts";
import { openDb, getSetting, setSetting, deleteSetting, type DB } from "./db.ts";
import { Bus } from "./bus.ts";
import { Auth } from "./auth.ts";
import { SettingsStore, type Settings } from "./settings.ts";
import { CameraStore, cameraJson, go2rtcSources, isPush, type CameraRecord, type CameraStatus, type CameraJson } from "./cameras.ts";
import { Recordings, type RecordingRow } from "./recordings.ts";
import { Push } from "./push.ts";
import { Go2rtc, codecSummary, freePort, type StreamDef } from "./go2rtc.ts";
import { Recorder } from "./recorder.ts";
import { MotionDetector, segmentDecidable, shouldKeepSegment } from "./motion.ts";
import { Storage } from "./storage/index.ts";
import { Rclone } from "./storage/rclone.ts";
import { GDriveFlows } from "./storage/gdrive.ts";
import { Onvif, type OnvifTarget } from "./onvif.ts";
import { GatewayHub } from "./gateway/hub.ts";
import { TunnelClient } from "./gateway/site.ts";
import { ensureBinaries, binaryVersion, type Binaries } from "./deps.ts";
import { runLocalRetention } from "./retention.ts";
import { probeStream, type StreamProbe } from "./media.ts";
import { demoId, demoSource, prepareDemoClips } from "./demo.ts";
import { credsFromUrl, hostFromUrl } from "./brands.ts";
import { logger, errMsg } from "./log.ts";
import { HttpError, newId, randomToken, sha256 } from "./util.ts";
import { run } from "./proc.ts";

const log = logger("app");

type GatewayLink = { url: string; siteId: string; secret: string; siteName?: string; enabled: boolean };

type LiveStatus = CameraStatus & { bytes?: number; bytesAt?: number; probed?: boolean; probing?: boolean; lastProbeAttempt?: number; ptzChecked?: boolean };

export type HandleMeta = { tunnel?: { role: string; user?: string; base?: string } };

export class App {
  readonly db: DB;
  readonly bus = new Bus();
  readonly auth: Auth;
  readonly settings: SettingsStore;
  readonly cameras: CameraStore;
  readonly recordings: Recordings;
  readonly push: Push;
  readonly onvif = new Onvif();
  readonly hub: GatewayHub;
  readonly internalSecret = randomToken(32);
  readonly startedAt = Date.now();
  ready = false;
  bins: Binaries = { go2rtc: undefined, ffmpeg: undefined, ffprobe: undefined, rclone: undefined };
  go2rtc!: Go2rtc;
  recorder!: Recorder;
  motion!: MotionDetector;
  storage!: Storage;
  gdrive!: GDriveFlows;
  tunnel?: TunnelClient;
  server?: Server<unknown>;
  handler?: (req: Request, meta: HandleMeta) => Promise<Response>;
  versions: Record<string, string | undefined> = {};
  private live = new Map<string, LiveStatus>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private snapCache = new Map<string, { at: number; data: Uint8Array; pending?: Promise<Uint8Array> }>();
  private applying = Promise.resolve();
  private ports: { rtsp?: number; api?: number } = {};
  private cpu = { usage: process.cpuUsage(), at: Date.now(), percent: 0 };

  readonly dirs: { recordings: string; thumbs: string; events: string; snapshots: string; clips: string; bin: string; rclone: string };

  constructor(readonly cfg: Config) {
    this.dirs = {
      recordings: dataPath(cfg, "recordings"),
      thumbs: dataPath(cfg, "thumbs"),
      events: dataPath(cfg, "events"),
      snapshots: dataPath(cfg, "snapshots"),
      clips: dataPath(cfg, "clips"),
      bin: dataPath(cfg, "bin"),
      rclone: dataPath(cfg, "rclone"),
    };
    for (const d of Object.values(this.dirs)) mkdirSync(d, { recursive: true });
    this.db = openDb(dataPath(cfg, "opencctv.db"));
    this.auth = new Auth(this.db);
    this.settings = new SettingsStore(this.db, cfg.demo ? { retention: { localDays: 1, maxLocalGB: 5, deleteLocalAfterUpload: false }, notifications: { enabled: false, cooldownSec: 300 } } : {});
    this.cameras = new CameraStore(this.db);
    this.recordings = new Recordings(this.db);
    this.push = new Push(this.db);
    this.hub = new GatewayHub(this.db, this.bus);
  }

  get rtspAuth(): { user: string; pass: string } {
    let a = getSetting<{ user: string; pass: string }>(this.db, "rtsp_auth");
    if (!a) {
      a = { user: "opencctv", pass: randomToken(12).replace(/[^A-Za-z0-9]/g, "x") };
      setSetting(this.db, "rtsp_auth", a);
    }
    return a;
  }

  async start(): Promise<void> {
    log.info(`OpenCCTV ${VERSION} starting, data dir ${this.cfg.dataDir}`);
    this.bins = await ensureBinaries(this.dirs.bin, !this.cfg.noDownload);
    this.go2rtc = new Go2rtc(this.bins.go2rtc, dataPath(this.cfg, "go2rtc.yaml"));
    const rclone = new Rclone(this.bins.rclone, this.dirs.rclone);
    this.storage = new Storage({
      db: this.db,
      bus: this.bus,
      recordingsDir: this.dirs.recordings,
      thumbsDir: this.dirs.thumbs,
      rclone,
      deleteLocalAfterUpload: () => this.settings.get().retention.deleteLocalAfterUpload,
    });
    this.gdrive = new GDriveFlows(this.cfg.google, async (input) => this.storage.create({ type: "gdrive", ...input }));
    this.recorder = new Recorder({
      recordingsDir: this.dirs.recordings,
      thumbsDir: this.dirs.thumbs,
      bins: this.bins,
      go2rtc: this.go2rtc,
      recordings: this.recordings,
      segmentSeconds: () => this.settings.get().recording.segmentSeconds,
      codecOf: (id) => this.live.get(id)?.codec,
      onSegment: (rec, cam) => this.onSegment(rec, cam),
      onStatus: (id) => this.refreshStatus(id),
      getCamera: (id) => this.cameras.get(id),
    });
    this.motion = new MotionDetector(
      this.bins.ffmpeg,
      this.go2rtc,
      {
        onStart: (cam, at, score) => this.onMotionStart(cam, at, score),
        onUpdate: (cam, score) => this.onMotionUpdate(cam, score),
        onEnd: (cam, s, e, peak) => this.onMotionEnd(cam, s, e, peak),
      },
      { postMotionSec: () => this.settings.get().recording.postMotionSec, keyframesOnly: this.cfg.demo },
    );
    if (this.cfg.demo) await this.setupDemo();
    this.cameras.onChange(() => this.scheduleApply());
    this.settings.onChange((s, prev) => {
      if (s.recording.segmentSeconds !== prev.recording.segmentSeconds || s.recording.postMotionSec !== prev.recording.postMotionSec) this.scheduleApply();
    });
    await this.applyCameras();
    this.recorder.start();
    this.motion.start();
    await this.storage.start();
    this.hub.start();
    this.startGatewayLink();
    this.timers.push(setInterval(() => void this.monitor(), 5000));
    this.timers.push(setInterval(() => void this.motionKeeper(), 10_000));
    this.timers.push(setInterval(() => this.retention(), 10 * 60_000));
    this.timers.push(setInterval(() => this.cleanupClips(), 60 * 60_000));
    setTimeout(() => this.retention(), 30_000);
    this.ready = true;
    for (const n of ["go2rtc", "ffmpeg", "rclone"] as const) this.versions[n] = await binaryVersion(this.bins[n], n);
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    this.tunnel?.stop();
    this.hub.stop();
    this.storage?.stop();
    await this.motion?.stopAll();
    await this.recorder?.stopAll();
    await this.go2rtc?.stop();
    this.db.close();
  }

  async bootstrapUsers() {
    const { adminUser, adminPassword } = this.cfg;
    const existing = adminUser ? this.auth.findByName(adminUser) : undefined;
    if (adminUser && adminPassword && !existing) {
      await this.auth.createUser(adminUser, adminPassword, "admin");
      log.info(`created admin user ${adminUser} from environment`);
    } else if (existing && existing.role !== "admin") log.warn(`OPENCCTV_ADMIN_USER ${adminUser} exists but is not an admin`);
    if (this.cfg.demo && !this.auth.findByName("demo")) {
      await this.auth.createUser("demo", "demo", "viewer");
      log.info("created demo viewer account demo/demo");
    }
  }

  private async setupDemo() {
    if (!this.bins.ffmpeg) {
      log.warn("demo mode needs ffmpeg");
      return;
    }
    const clips = await prepareDemoClips({ dataDir: this.cfg.dataDir, demoDir: this.cfg.demoDir, urls: this.cfg.demoUrls });
    for (const clip of clips) {
      const id = demoId(clip.name);
      const url = demoSource(this.bins.ffmpeg, clip);
      const existing = this.cameras.get(id);
      if (existing) {
        if (existing.url !== url) this.db.query("UPDATE cameras SET url = ? WHERE id = ?").run(url, id);
        continue;
      }
      this.cameras.create({
        id,
        name: clip.name,
        brand: "demo",
        built: { kind: "demo", url },
        fields: {},
        defaultSensitivity: 5,
      });
    }
  }

  // camera pipeline

  private scheduleApply() {
    this.applying = this.applying.then(() => this.applyCameras()).catch((e) => log.error(`apply: ${errMsg(e)}`));
  }

  async applyCameras(): Promise<void> {
    const cams = this.cameras.list();
    const enabled = cams.filter((c) => c.enabled);
    if (this.go2rtc.available && (enabled.length || this.go2rtc.running)) {
      const streams: StreamDef[] = [];
      for (const c of enabled) streams.push(...go2rtcSources(c, !!this.bins.ffmpeg));
      const rtspPublic = this.cfg.rtspPublic || enabled.some((c) => c.kind === "rtsp-push");
      if (rtspPublic) this.ports.rtsp = this.cfg.rtspPort;
      else if (!this.ports.rtsp || this.ports.rtsp === this.cfg.rtspPort) this.ports.rtsp = await freePort();
      this.ports.api ??= await freePort();
      const rtspPort = this.ports.rtsp;
      const apiPort = this.ports.api;
      const custom = process.env.OPENCCTV_WEBRTC_CANDIDATES?.split(",").map((s) => s.trim()).filter(Boolean);
      const candidates = custom?.length ? custom : [`stun:${this.cfg.webrtcPort}`];
      const auth = this.rtspAuth;
      await this.go2rtc.apply({
        apiPort,
        rtspListen: `${rtspPublic ? "0.0.0.0" : "127.0.0.1"}:${rtspPort}`,
        rtspUser: auth.user,
        rtspPass: auth.pass,
        rtmpListen: enabled.some((c) => c.kind === "rtmp-push") ? `0.0.0.0:${this.cfg.rtmpPort}` : "",
        webrtcListen: process.env.OPENCCTV_WEBRTC_DISABLE === "1" ? "" : `:${this.cfg.webrtcPort}`,
        webrtcCandidates: candidates,
        ffmpegBin: this.bins.ffmpeg,
        streams,
      });
    }
    const ready = this.go2rtc.running;
    this.recorder.sync(cams, ready);
    this.motion.sync(cams, ready);
    for (const id of [...this.live.keys()]) if (!cams.some((c) => c.id === id)) this.live.delete(id);
  }

  status(cam: CameraRecord): CameraStatus {
    const l = this.live.get(cam.id);
    const recording = this.recorder?.isRecording(cam.id) ?? false;
    return {
      online: cam.enabled && !!l?.online,
      recording,
      lastSeen: l?.lastSeen,
      codec: l?.codec,
      width: l?.width,
      height: l?.height,
      fps: l?.fps,
      bitrateKbps: l?.bitrateKbps,
      error: !cam.enabled ? undefined : l?.error ?? (cam.recordingMode !== "off" ? this.recorder?.errorOf(cam.id) : undefined),
    };
  }

  cameraJson(cam: CameraRecord, base?: string): CameraJson {
    let pushBase: { rtsp: string; rtmp: string } | undefined;
    if (isPush(cam.kind)) {
      const host = base ? new URL(base).hostname : "SERVER_IP";
      const a = this.rtspAuth;
      pushBase = { rtsp: `rtsp://${a.user}:${a.pass}@${host}:${this.cfg.rtspPort}`, rtmp: `rtmp://${host}:${this.cfg.rtmpPort}` };
    }
    return cameraJson(cam, this.status(cam), pushBase);
  }

  private emitCamera(id: string) {
    const cam = this.cameras.get(id);
    if (cam) this.bus.emit({ type: "camera", camera: this.cameraJson(cam) });
  }

  private refreshStatus(id: string) {
    this.emitCamera(id);
  }

  private async monitor() {
    if (!this.go2rtc.running) return;
    const streams = await this.go2rtc.streams();
    const now = Date.now();
    for (const cam of this.cameras.list()) {
      if (!cam.enabled) continue;
      const l: LiveStatus = this.live.get(cam.id) ?? { online: false, recording: false };
      this.live.set(cam.id, l);
      const before = JSON.stringify([l.online, l.codec, l.error, l.width, this.recorder.isRecording(cam.id)]);
      const sum = codecSummary(streams[cam.streamKey]);
      if (sum.online) {
        if (l.bytes !== undefined && l.bytesAt && sum.bytes >= l.bytes) {
          const kbps = Math.round(((sum.bytes - l.bytes) * 8) / (now - l.bytesAt));
          l.bitrateKbps = kbps;
          if (sum.bytes > l.bytes) {
            l.online = true;
            l.lastSeen = new Date(now).toISOString();
            l.error = undefined;
          } else if (now - Date.parse(l.lastSeen ?? "0") > 20_000) l.online = false;
        } else if (!l.lastSeen) {
          l.online = true;
          l.lastSeen = new Date(now).toISOString();
        }
        l.bytes = sum.bytes;
        l.bytesAt = now;
        if (sum.codec) l.codec = sum.codec === "h265" ? "hevc" : sum.codec;
        if (!l.probed && !l.probing && now - (l.lastProbeAttempt ?? 0) > 60_000) void this.probe(cam, l);
      } else {
        l.bytes = undefined;
        if (l.lastSeen && now - Date.parse(l.lastSeen) > 30_000) l.online = false;
        if (now - (l.lastProbeAttempt ?? 0) > 60_000 && !l.probing) void this.probeSnapshot(cam, l);
      }
      if (!l.ptzChecked) void this.checkPtz(cam, l);
      const after = JSON.stringify([l.online, l.codec, l.error, l.width, this.recorder.isRecording(cam.id)]);
      if (before !== after) this.emitCamera(cam.id);
    }
  }

  private async probe(cam: CameraRecord, l: LiveStatus) {
    l.probing = true;
    l.lastProbeAttempt = Date.now();
    try {
      const p: StreamProbe | undefined = await probeStream(this.bins.ffprobe, this.go2rtc.rtspUrl(cam.streamKey, "video&audio"));
      if (p) {
        l.probed = true;
        l.codec = p.codec ?? l.codec;
        l.width = p.width;
        l.height = p.height;
        l.fps = p.fps;
        const audio = !!p.audio;
        if (!!cam.caps.audio !== audio) this.cameras.setCaps(cam.id, { audio });
        this.emitCamera(cam.id);
      }
    } finally {
      l.probing = false;
    }
  }

  private async probeSnapshot(cam: CameraRecord, l: LiveStatus) {
    l.probing = true;
    l.lastProbeAttempt = Date.now();
    try {
      await this.snapshot(cam, 320);
      l.online = true;
      l.lastSeen = new Date().toISOString();
      l.error = undefined;
    } catch (e) {
      l.online = false;
      l.error = errMsg(e).slice(0, 200);
    } finally {
      l.probing = false;
    }
  }

  onvifTarget(cam: CameraRecord): OnvifTarget | undefined {
    const port = cam.caps.ptzPort;
    if (!port || cam.kind === "demo" || isPush(cam.kind)) return undefined;
    const host = cam.fields.host || hostFromUrl(cam.url);
    if (!host) return undefined;
    const creds = cam.fields.username !== undefined ? { username: cam.fields.username, password: cam.fields.password ?? "" } : credsFromUrl(cam.url);
    return { host, port, username: creds.username, password: creds.password };
  }

  private async checkPtz(cam: CameraRecord, l: LiveStatus) {
    l.ptzChecked = true;
    const t = this.onvifTarget(cam);
    if (!t) return;
    try {
      const ptz = await this.onvif.hasPtz(t);
      let presets: { id: string; name: string }[] = [];
      if (ptz) presets = (await this.onvif.presets(t).catch(() => [])).map((p) => ({ id: p.token, name: p.name }));
      if (ptz !== !!cam.caps.ptz || JSON.stringify(presets) !== JSON.stringify(cam.caps.ptzPresets ?? [])) {
        this.cameras.setCaps(cam.id, { ptz, ptzPresets: presets });
        this.emitCamera(cam.id);
      }
    } catch (e) {
      log.debug(`onvif ${cam.name}: ${errMsg(e)}`);
    }
  }

  async snapshot(cam: CameraRecord, width?: number): Promise<Uint8Array> {
    const key = `${cam.id}:${width ?? 0}`;
    const hit = this.snapCache.get(key);
    const now = Date.now();
    if (hit && now - hit.at < 2000 && hit.data.length) return hit.data;
    if (hit?.pending) return hit.pending;
    const pending = this.go2rtc.frame(cam.streamKey, width).then(
      (data) => {
        this.snapCache.set(key, { at: Date.now(), data });
        const file = join(this.dirs.snapshots, `${cam.id}.jpg`);
        try {
          if (!width || width >= 480) {
            const st = existsSync(file) ? statSync(file) : undefined;
            if (!st || Date.now() - st.mtimeMs > 60_000) writeFileSync(file, data);
          }
        } catch {}
        return data;
      },
      (e) => {
        this.snapCache.delete(key);
        throw e;
      },
    );
    this.snapCache.set(key, { at: 0, data: new Uint8Array(0), pending });
    return pending;
  }

  lastSnapshot(camId: string): Uint8Array | undefined {
    const file = join(this.dirs.snapshots, `${camId}.jpg`);
    return existsSync(file) ? new Uint8Array(readFileSync(file)) : undefined;
  }

  async testCamera(sources: string[], subUrl?: string): Promise<{ ok: boolean; error?: string; codec?: string; width?: number; height?: number; audio?: boolean; snapshot?: string }> {
    if (!this.go2rtc.available) return { ok: false, error: "go2rtc is not installed" };
    if (!this.go2rtc.running) {
      await this.applyCameras();
      if (!this.go2rtc.running) {
        await this.go2rtc.apply({
          apiPort: await freePort(),
          rtspListen: `127.0.0.1:${await freePort()}`,
          rtspUser: this.rtspAuth.user,
          rtspPass: this.rtspAuth.pass,
          ffmpegBin: this.bins.ffmpeg,
          streams: [],
        });
      }
    }
    const name = `test_${newId(8)}`;
    try {
      await this.go2rtc.addTemporaryStream(name, sources[0]!);
      const jpg = await this.go2rtc.frame(name, 640, 15_000);
      const info = await probeStream(this.bins.ffprobe, this.go2rtc.rtspUrl(name, "video&audio"), 10_000);
      void subUrl;
      return { ok: true, codec: info?.codec, width: info?.width, height: info?.height, audio: !!info?.audio, snapshot: Buffer.from(jpg).toString("base64") };
    } catch (e) {
      let msg = errMsg(e);
      const src = sources[0]!;
      if (this.bins.ffprobe && /^rtsps?:\/\//.test(src)) {
        const r = await run([this.bins.ffprobe, "-v", "error", "-rtsp_transport", "tcp", "-timeout", "6000000", "-i", src], { timeoutMs: 9000 });
        const line = r.stderr.split("\n").map((l) => l.trim()).filter(Boolean).pop();
        if (r.code !== 0 && line) msg = line.replace(src, "").replace(/^[^:]*:\s*/, "");
      }
      return { ok: false, error: friendlyStreamError(msg) };
    } finally {
      await this.go2rtc.removeStream(name);
    }
  }

  // recordings & motion

  private onSegment(rec: RecordingRow, cam: CameraRecord) {
    if (rec.state !== "kept") return;
    this.storage.enqueue(rec, cam);
    const json = this.recordings.json(rec.id);
    if (json) this.bus.emit({ type: "recording", recording: json });
  }

  private openEvents = new Map<string, string>();

  private onMotionStart(cam: CameraRecord, at: number, score: number) {
    const id = newId(12);
    this.openEvents.set(cam.id, id);
    this.recordings.insertEvent({ id, camera_id: cam.id, start_ms: at, end_ms: null, score, snapshot_path: null });
    void (async () => {
      try {
        const jpg = await this.go2rtc.frame(cam.streamKey, 640, 8000);
        const rel = `${cam.id}/${id}.jpg`;
        mkdirSync(join(this.dirs.events, cam.id), { recursive: true });
        writeFileSync(join(this.dirs.events, rel), jpg);
        this.recordings.setEventSnapshot(id, rel);
      } catch (e) {
        log.debug(`event snapshot ${cam.name}: ${errMsg(e)}`);
      }
      const ev = this.recordings.getEvent(id);
      if (ev) this.bus.emit({ type: "motion", event: this.recordings.eventJsonFor(ev) });
      const s = this.settings.get();
      if (s.notifications.enabled && cam.notify && cam.motionEnabled) {
        await this.push.notifyMotion({ cameraId: cam.id, cameraName: cam.name, eventId: id, serverName: s.serverName, cooldownSec: s.notifications.cooldownSec, at, publicUrl: this.cfg.publicUrl });
      }
    })();
  }

  private onMotionUpdate(cam: CameraRecord, score: number) {
    const id = this.openEvents.get(cam.id);
    if (id) this.recordings.updateEvent(id, null, score);
  }

  private onMotionEnd(cam: CameraRecord, _start: number, end: number, peak: number) {
    const id = this.openEvents.get(cam.id);
    if (!id) return;
    this.openEvents.delete(cam.id);
    this.recordings.updateEvent(id, end, peak);
    const ev = this.recordings.getEvent(id);
    if (ev) this.bus.emit({ type: "motion", event: this.recordings.eventJsonFor(ev) });
  }

  private async motionKeeper() {
    const s = this.settings.get();
    const pre = s.recording.preMotionSec * 1000;
    const post = s.recording.postMotionSec * 1000;
    const now = Date.now();
    for (const rec of this.recordings.pending()) {
      const cam = this.cameras.get(rec.camera_id);
      if (!cam || cam.recordingMode !== "motion") {
        this.recordings.setState(rec.id, "kept");
        if (cam) this.onSegment({ ...rec, state: "kept" }, cam);
        continue;
      }
      const open = this.motion.active(cam.id);
      const events = this.recordings.eventsOverlapping(cam.id, rec.start_ms - post, rec.end_ms + pre).map((e) => ({ start: e.start_ms, end: e.end_ms }));
      if (shouldKeepSegment({ start: rec.start_ms, end: rec.end_ms }, events, pre, post, now)) {
        this.recordings.setState(rec.id, "kept");
        this.onSegment({ ...rec, state: "kept" }, cam);
      } else if (segmentDecidable({ end: rec.end_ms }, pre, now, open)) {
        this.deleteRecordingFiles(rec);
        this.recordings.remove(rec.id);
      }
    }
  }

  deleteRecordingFiles(rec: RecordingRow) {
    for (const p of [rec.path ? join(this.dirs.recordings, rec.path) : undefined, rec.thumb_path ? join(this.dirs.thumbs, rec.thumb_path) : undefined]) {
      if (!p) continue;
      try {
        unlinkSync(p);
      } catch {}
    }
  }

  async deleteRecording(id: string) {
    const rec = this.recordings.require(id);
    this.deleteRecordingFiles(rec);
    await this.storage.deleteRemoteCopies(id);
    this.recordings.remove(id);
  }

  retention() {
    try {
      runLocalRetention({
        db: this.db,
        dataDir: this.cfg.dataDir,
        recordingsDir: this.dirs.recordings,
        thumbsDir: this.dirs.thumbs,
        eventsDir: this.dirs.events,
        settings: () => this.settings.get().retention,
        maxRemoteDays: () => Math.max(0, ...this.storage.list().filter((t) => t.enabled).map((t) => t.retentionDays)),
        hasRemote: (id) => this.storage.hasRemote(id),
      });
    } catch (e) {
      log.error(`retention: ${errMsg(e)}`);
    }
  }

  async exportClip(cameraId: string, start: number, end: number): Promise<string> {
    if (!this.bins.ffmpeg) throw new HttpError(503, "ffmpeg is not available");
    if (!(end > start)) throw new HttpError(400, "end must be after start");
    if (end - start > 60 * 60_000) throw new HttpError(400, "Clips are limited to 1 hour");
    const recs = this.recordings.overlapping(cameraId, start, end).filter((r) => r.path);
    if (!recs.length) throw new HttpError(404, "No local footage in this range");
    const id = newId(16);
    const list = join(this.dirs.clips, `${id}.txt`);
    writeFileSync(list, recs.map((r) => `file '${join(this.dirs.recordings, r.path!).replace(/'/g, "'\\''")}'`).join("\n"));
    const offset = Math.max(0, (start - recs[0]!.start_ms) / 1000);
    const out = join(this.dirs.clips, `${id}.mp4`);
    const r = await run(
      [this.bins.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-ss", offset.toFixed(2), "-t", ((end - start) / 1000).toFixed(2), "-c", "copy", "-movflags", "+faststart", out],
      { timeoutMs: 5 * 60_000 },
    );
    try {
      unlinkSync(list);
    } catch {}
    if (r.code !== 0) throw new HttpError(500, `Export failed: ${r.stderr.trim().slice(0, 200)}`);
    return id;
  }

  private cleanupClips() {
    try {
      for (const f of readdirSync(this.dirs.clips)) {
        const p = join(this.dirs.clips, f);
        if (Date.now() - statSync(p).mtimeMs > 24 * 3600_000) unlinkSync(p);
      }
    } catch {}
  }

  // gateway (site side)

  gatewayLink(): GatewayLink | undefined {
    return getSetting<GatewayLink>(this.db, "gateway_link");
  }

  private startGatewayLink() {
    const link = this.gatewayLink();
    if (!link?.enabled) return;
    this.tunnel?.stop();
    this.tunnel = new TunnelClient({
      url: link.url,
      siteId: link.siteId,
      secret: link.secret,
      internalSecret: this.internalSecret,
      hello: () => ({ version: VERSION, cameras: this.cameras.count(), name: this.settings.get().serverName }),
      handle: (req, meta) => this.handler!(req, { tunnel: meta }),
      localWsBase: () => `ws://127.0.0.1:${this.server?.port ?? this.cfg.port}`,
    });
    this.tunnel.start();
  }

  async linkGateway(url: string, linkCode: string): Promise<{ siteId: string }> {
    let base: URL;
    try {
      base = new URL(url);
      if (!/^https?:$/.test(base.protocol)) throw new Error();
    } catch {
      throw new HttpError(400, "Gateway URL must start with http:// or https://");
    }
    const clean = base.toString().replace(/\/+$/, "");
    let res: Response;
    try {
      res = await fetch(`${clean}/api/gateway/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ linkCode, name: this.settings.get().serverName, version: VERSION }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new HttpError(502, `Cannot reach gateway: ${errMsg(e)}`);
    }
    const j = (await res.json().catch(() => ({}))) as { siteId?: string; secret?: string; name?: string; error?: string };
    if (!res.ok || !j.siteId || !j.secret) throw new HttpError(res.status === 401 ? 400 : 502, j.error ?? `Gateway refused the link (${res.status})`);
    setSetting(this.db, "gateway_link", { url: clean, siteId: j.siteId, secret: j.secret, siteName: j.name, enabled: true } satisfies GatewayLink);
    this.startGatewayLink();
    return { siteId: j.siteId };
  }

  unlinkGateway() {
    this.tunnel?.stop();
    this.tunnel = undefined;
    deleteSetting(this.db, "gateway_link");
  }

  settingsJson(): Settings & { gateway: { url?: string; siteName?: string; siteId?: string; connected: boolean; enabled: boolean; error?: string } } {
    const link = this.gatewayLink();
    return {
      ...this.settings.get(),
      gateway: {
        url: link?.url,
        siteName: link?.siteName,
        siteId: link?.siteId,
        connected: !!this.tunnel?.connected,
        enabled: !!link?.enabled,
        error: link?.enabled && !this.tunnel?.connected ? this.tunnel?.lastError : undefined,
      },
    };
  }

  // system

  disk(path = this.dirs.recordings): { path: string; usedBytes: number; freeBytes: number; totalBytes: number } {
    try {
      const s = statfsSync(path);
      const total = s.blocks * s.bsize;
      const free = s.bavail * s.bsize;
      return { path, usedBytes: this.recordings.stats().bytes, freeBytes: free, totalBytes: total };
    } catch {
      return { path, usedBytes: this.recordings.stats().bytes, freeBytes: 0, totalBytes: 0 };
    }
  }

  cpuPercent(): number {
    const now = Date.now();
    if (now - this.cpu.at > 2000) {
      const u = process.cpuUsage(this.cpu.usage);
      this.cpu.percent = Math.round(((u.user + u.system) / 1000 / (now - this.cpu.at)) * 1000) / 10;
      this.cpu.usage = process.cpuUsage();
      this.cpu.at = now;
    }
    return this.cpu.percent;
  }

  tokenHashOf(token: string) {
    return sha256(token);
  }
}

export function friendlyStreamError(msg: string): string {
  if (/401|unauthori[sz]ed|auth/i.test(msg)) return "Authentication failed. Check the username and password.";
  if (/timeout|i\/o timeout|deadline/i.test(msg)) return "The camera did not respond in time. Check the IP address and that RTSP is enabled.";
  if (/connection refused|refused/i.test(msg)) return "Connection refused. Check the port and that RTSP is enabled on the camera.";
  if (/no route|unreachable|no such host/i.test(msg)) return "Camera is not reachable from this server.";
  if (/404|not found/i.test(msg)) return "Stream path not found on the camera.";
  return msg.slice(0, 300);
}
