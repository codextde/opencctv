import { writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { Supervisor } from "./proc.ts";
import { errMsg } from "./log.ts";

export type StreamDef = { name: string; sources: string[] };

export type Go2rtcOptions = {
  apiPort: number;
  rtspListen: string;
  rtspUser: string;
  rtspPass: string;
  rtmpListen?: string;
  webrtcListen?: string;
  webrtcCandidates?: string[];
  ffmpegBin?: string;
  streams: StreamDef[];
};

const q = (s: string) => JSON.stringify(s);

export function buildGo2rtcYaml(o: Go2rtcOptions): string {
  const lines: string[] = [];
  lines.push("api:", `  listen: ${q(`127.0.0.1:${o.apiPort}`)}`, `  origin: ""`);
  lines.push("rtsp:", `  listen: ${q(o.rtspListen)}`, `  username: ${q(o.rtspUser)}`, `  password: ${q(o.rtspPass)}`, `  default_query: "video&audio"`);
  lines.push("rtmp:", `  listen: ${q(o.rtmpListen ?? "")}`);
  lines.push("srtp:", `  listen: ""`);
  lines.push("webrtc:", `  listen: ${q(o.webrtcListen ?? "")}`);
  if (o.webrtcCandidates?.length) {
    lines.push("  candidates:");
    for (const c of o.webrtcCandidates) lines.push(`    - ${q(c)}`);
  }
  if (o.ffmpegBin) lines.push("ffmpeg:", `  bin: ${q(o.ffmpegBin)}`);
  lines.push("log:", `  level: "info"`, `  format: "text"`);
  lines.push("streams:");
  if (!o.streams.length) lines.push("  _idle: []");
  for (const s of o.streams) {
    if (!/^[A-Za-z0-9_-]+$/.test(s.name)) continue;
    if (!s.sources.length) {
      lines.push(`  ${s.name}: []`);
      continue;
    }
    lines.push(`  ${s.name}:`);
    for (const src of s.sources) lines.push(`    - ${q(src)}`);
  }
  return lines.join("\n") + "\n";
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

export type ProducerInfo = {
  url?: string;
  source?: string;
  medias?: string[];
  receivers?: { codec?: { codec_name?: string; codec_type?: string; sample_rate?: number } ; bytes?: number }[];
  bytes_recv?: number;
};
export type StreamInfo = { producers: ProducerInfo[] | null; consumers: unknown[] | null };

export class Go2rtc {
  private sup: Supervisor;
  private configPath: string;
  private opts?: Go2rtcOptions;
  private readyPromise?: Promise<void>;
  version?: string;

  constructor(private bin: string | undefined, configPath: string) {
    this.configPath = configPath;
    this.sup = new Supervisor("go2rtc", {
      command: () => (this.bin ? { cmd: [this.bin, "-config", this.configPath] } : undefined),
      onStderr: (l) => this.onLine(l),
      onStdout: (l) => this.onLine(l),
      minBackoffMs: 1000,
      maxBackoffMs: 30_000,
    });
  }

  get available(): boolean {
    return !!this.bin;
  }

  get running(): boolean {
    return this.sup.running;
  }

  get apiBase(): string {
    return `http://127.0.0.1:${this.opts?.apiPort ?? 0}`;
  }

  get rtspPort(): number {
    return Number(this.opts?.rtspListen.split(":").pop() ?? 8554);
  }

  rtspUrl(stream: string, query = ""): string {
    return `rtsp://127.0.0.1:${this.rtspPort}/${stream}${query ? "?" + query : ""}`;
  }

  private onLine(line: string) {
    const m = line.match(/version=(\S+)/);
    if (m && !this.version) this.version = m[1];
    if (/\b(ERR|WRN|FTL)\b/.test(line) && !/connection reset|broken pipe|EOF$/.test(line)) this.sup.log.warn(line.replace(/^\S+\s+/, ""));
    else this.sup.log.debug(line);
  }

  async apply(opts: Go2rtcOptions): Promise<void> {
    if (!this.bin) return;
    const yaml = buildGo2rtcYaml(opts);
    const prevOpts = this.opts;
    const prev = prevOpts ? buildGo2rtcYaml(prevOpts) : "";
    this.opts = opts;
    if (yaml === prev && this.sup.running) return;
    writeFileSync(this.configPath, yaml, { mode: 0o600 });
    if (this.sup.running && prevOpts && sameBase(prevOpts, opts)) {
      try {
        await this.applyStreams(prevOpts.streams, opts.streams);
        return;
      } catch (e) {
        this.sup.log.warn(`live stream update failed, restarting go2rtc: ${errMsg(e)}`);
      }
    }
    if (this.sup.running) await this.sup.restart();
    else this.sup.start();
    this.readyPromise = this.waitReady();
    await this.readyPromise;
  }

  private async applyStreams(before: StreamDef[], after: StreamDef[]): Promise<void> {
    const key = (s: StreamDef) => JSON.stringify(s.sources);
    const old = new Map(before.map((s) => [s.name, key(s)]));
    const next = new Map(after.map((s) => [s.name, s]));
    for (const name of old.keys()) {
      const n = next.get(name);
      if (!n || key(n) !== old.get(name)) await this.removeStream(name);
    }
    for (const [name, s] of next) {
      if (old.get(name) === key(s)) continue;
      if (!s.sources.length) throw new Error(`stream ${name} has no source`);
      const q = new URLSearchParams({ name });
      for (const src of s.sources) q.append("src", src);
      const r = await fetch(`${this.apiBase}/api/streams?${q.toString()}`, { method: "PUT", signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`PUT ${name}: ${r.status} ${await r.text()}`);
    }
  }

  private async waitReady(): Promise<void> {
    for (let i = 0; i < 50; i++) {
      try {
        const r = await fetch(`${this.apiBase}/api`, { signal: AbortSignal.timeout(500) });
        if (r.ok) {
          const info = (await r.json()) as { version?: string };
          this.version = info.version ?? this.version;
          return;
        }
      } catch {}
      await Bun.sleep(200);
    }
    this.sup.log.warn("go2rtc API did not become ready");
  }

  async ready(): Promise<void> {
    await this.readyPromise;
  }

  async stop(): Promise<void> {
    await this.sup.stop();
  }

  async streams(): Promise<Record<string, StreamInfo>> {
    if (!this.sup.running) return {};
    try {
      const r = await fetch(`${this.apiBase}/api/streams`, { signal: AbortSignal.timeout(3000) });
      return r.ok ? ((await r.json()) as Record<string, StreamInfo>) : {};
    } catch {
      return {};
    }
  }

  async addTemporaryStream(name: string, src: string): Promise<void> {
    const u = `${this.apiBase}/api/streams?name=${encodeURIComponent(name)}&src=${encodeURIComponent(src)}`;
    const r = await fetch(u, { method: "PUT", signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`go2rtc rejected stream: ${await r.text()}`);
  }

  async removeStream(name: string): Promise<void> {
    await fetch(`${this.apiBase}/api/streams?src=${encodeURIComponent(name)}`, { method: "DELETE", signal: AbortSignal.timeout(5000) }).catch(() => {});
  }

  async frame(stream: string, width?: number, timeoutMs = 12_000): Promise<Uint8Array> {
    if (!this.sup.running) throw new Error("go2rtc is not running");
    const u = new URL(`${this.apiBase}/api/frame.jpeg`);
    u.searchParams.set("src", stream);
    if (width) u.searchParams.set("width", String(width));
    const r = await fetch(u, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new Error((await r.text()).trim().slice(0, 300) || `snapshot failed (${r.status})`);
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8) {
      const text = new TextDecoder().decode(buf.subarray(0, 300)).trim();
      throw new Error(/^[\x20-\x7e\s]+$/.test(text) && text ? text : "camera returned no image");
    }
    return buf;
  }

  fetch(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${this.apiBase}${path}`, init);
  }

  wsUrl(path: string): string {
    return `ws://127.0.0.1:${this.opts?.apiPort ?? 0}${path}`;
  }

  async webrtc(stream: string, sdp: string): Promise<string> {
    const r = await fetch(`${this.apiBase}/api/webrtc?src=${encodeURIComponent(stream)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "offer", sdp }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(text.trim() || `webrtc failed (${r.status})`);
    try {
      const j = JSON.parse(text) as { sdp?: string };
      if (j.sdp) return j.sdp;
    } catch {}
    if (text.startsWith("v=")) return text;
    throw new Error("unexpected webrtc answer");
  }
}

function sameBase(a: Go2rtcOptions, b: Go2rtcOptions): boolean {
  return buildGo2rtcYaml({ ...a, streams: [] }) === buildGo2rtcYaml({ ...b, streams: [] });
}

export function codecSummary(info: StreamInfo | undefined): { online: boolean; codec?: string; audio?: string; bytes: number } {
  let online = false;
  let codec: string | undefined;
  let audio: string | undefined;
  let bytes = 0;
  for (const p of info?.producers ?? []) {
    if (p.receivers?.length || p.bytes_recv) online = true;
    bytes += p.bytes_recv ?? 0;
    for (const r of p.receivers ?? []) {
      if (r.codec?.codec_type === "video" && !codec) codec = r.codec.codec_name;
      if (r.codec?.codec_type === "audio" && !audio) audio = r.codec.codec_name;
    }
    if (!codec)
      for (const m of p.medias ?? []) {
        const mm = m.match(/^video, \w+, ([A-Z0-9]+)/);
        if (mm) codec = mm[1]!.toLowerCase();
      }
  }
  return { online, codec, audio, bytes };
}

export { errMsg };
