import type { DB } from "./db.ts";
import { buildSource, getBrand, type BuiltSource, type SourceKind } from "./brands.ts";
import { HttpError, MASK, clamp, isPlainObject, maskUrl, newId, randomToken, str, toIso } from "./util.ts";

export type RecordingMode = "continuous" | "motion" | "off";

export type CameraStatus = {
  online: boolean;
  recording: boolean;
  lastSeen?: string;
  codec?: string;
  width?: number;
  height?: number;
  fps?: number;
  bitrateKbps?: number;
  error?: string;
};

export type CameraCaps = { audio: boolean; twoWayAudio: boolean; ptz: boolean; substream: boolean; ptzPresets?: { id: string; name: string }[] };

export type CameraRow = {
  id: string;
  name: string;
  brand: string;
  kind: SourceKind;
  fields_json: string;
  url: string;
  sub_url: string | null;
  grp: string | null;
  ord: number;
  enabled: number;
  recording_mode: RecordingMode;
  use_substream: number;
  motion_enabled: number;
  sensitivity: number;
  notify: number;
  caps_json: string;
  stream_key: string;
  created_at: number;
};

export type CameraRecord = {
  id: string;
  name: string;
  brand: string;
  kind: SourceKind;
  fields: Record<string, string>;
  url: string;
  subUrl?: string;
  group?: string;
  order: number;
  enabled: boolean;
  recordingMode: RecordingMode;
  useSubstream: boolean;
  motionEnabled: boolean;
  sensitivity: number;
  notify: boolean;
  caps: Partial<CameraCaps> & { ptzPort?: number; extra?: string[] };
  streamKey: string;
  createdAt: number;
};

export type CameraJson = {
  id: string;
  name: string;
  brand: string;
  group?: string;
  order: number;
  enabled: boolean;
  source: { kind: SourceKind; url: string; subUrl?: string };
  fields: Record<string, string>;
  recording: { mode: RecordingMode; useSubstream: boolean };
  motion: { enabled: boolean; sensitivity: number; notify: boolean };
  capabilities: CameraCaps;
  status: CameraStatus;
  push?: { url: string };
  createdAt: string;
};

function fromRow(r: CameraRow): CameraRecord {
  return {
    id: r.id,
    name: r.name,
    brand: r.brand,
    kind: r.kind,
    fields: JSON.parse(r.fields_json || "{}"),
    url: r.url,
    subUrl: r.sub_url ?? undefined,
    group: r.grp ?? undefined,
    order: r.ord,
    enabled: !!r.enabled,
    recordingMode: r.recording_mode,
    useSubstream: !!r.use_substream,
    motionEnabled: !!r.motion_enabled,
    sensitivity: r.sensitivity,
    notify: !!r.notify,
    caps: JSON.parse(r.caps_json || "{}"),
    streamKey: r.stream_key,
    createdAt: r.created_at,
  };
}

export function isPush(kind: SourceKind): boolean {
  return kind === "rtsp-push" || kind === "rtmp-push";
}

export function subStreamName(c: CameraRecord): string | undefined {
  return c.subUrl ? `${c.streamKey}_sub` : undefined;
}

export function go2rtcSources(c: CameraRecord, ffmpegAvailable: boolean): { name: string; sources: string[] }[] {
  const main: string[] = [];
  const out: { name: string; sources: string[] }[] = [];
  if (isPush(c.kind)) {
    out.push({ name: c.streamKey, sources: [] });
    return out;
  }
  if (c.kind === "demo") {
    out.push({ name: c.streamKey, sources: ffmpegAvailable ? [c.url, `ffmpeg:${c.streamKey}#video=mjpeg`] : [c.url] });
    return out;
  }
  main.push(c.url);
  for (const e of c.caps.extra ?? []) main.push(e);
  if (ffmpegAvailable) {
    if (c.kind === "http") main.push(`ffmpeg:${c.streamKey}#video=h264`);
    else main.push(`ffmpeg:${c.streamKey}#audio=aac`, `ffmpeg:${c.streamKey}#video=mjpeg`);
  }
  out.push({ name: c.streamKey, sources: main });
  if (c.subUrl) out.push({ name: `${c.streamKey}_sub`, sources: [c.subUrl] });
  return out;
}

const PASSWORD_KEYS = new Set(["password", "cloudPassword", "pass", "secret"]);

export function maskFields(brand: string, fields: Record<string, string>): Record<string, string> {
  const b = getBrand(brand);
  const secretKeys = new Set([...(b?.fields.filter((f) => f.type === "password").map((f) => f.key) ?? []), ...PASSWORD_KEYS]);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (secretKeys.has(k)) out[k] = v ? MASK : "";
    else if (k === "url" || k === "subUrl") out[k] = maskUrl(v);
    else out[k] = v;
  }
  return out;
}

export function unmaskFields(input: Record<string, string>, previous: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === MASK && previous[k] !== undefined) out[k] = previous[k]!;
    else if ((k === "url" || k === "subUrl") && v.includes(`:${MASK}@`) && previous[k]) {
      const prevPass = previous[k]!.match(/^[a-z0-9+.-]+:\/\/[^:/@]*:([^@]*)@/i)?.[1] ?? "";
      out[k] = v.replace(`:${MASK}@`, `:${prevPass}@`);
    } else out[k] = v;
  }
  return out;
}

export type CameraInput = {
  name?: unknown;
  brand?: unknown;
  kind?: unknown;
  fields?: unknown;
  url?: unknown;
  subUrl?: unknown;
};

export function normalizeInput(body: CameraInput): { name: string; brand: string; kind?: string; fields: Record<string, string> } {
  const brand = str(body.brand ?? "generic", "brand", { max: 40 }) || "generic";
  if (brand === "demo") throw new HttpError(400, "Demo cameras cannot be created through the API");
  if (!getBrand(brand)) throw new HttpError(400, `Unknown brand ${brand}`);
  const fields: Record<string, string> = {};
  if (isPlainObject(body.fields)) for (const [k, v] of Object.entries(body.fields)) if (v !== undefined && v !== null) fields[k] = String(v).slice(0, 2000);
  if (body.url !== undefined) fields.url = str(body.url, "url");
  if (body.subUrl !== undefined) fields.subUrl = str(body.subUrl, "subUrl");
  const kind = body.kind ? str(body.kind, "kind", { max: 20 }) : fields.kind || undefined;
  const name = str(body.name, "name", { max: 80 }).trim();
  return { name, brand, kind, fields };
}

export class CameraStore {
  private listeners: (() => void)[] = [];

  constructor(private db: DB) {}

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private changed() {
    for (const l of this.listeners) l();
  }

  list(): CameraRecord[] {
    return (this.db.query("SELECT * FROM cameras ORDER BY ord, created_at").all() as CameraRow[]).map(fromRow);
  }

  get(id: string): CameraRecord | undefined {
    const r = this.db.query("SELECT * FROM cameras WHERE id = ?").get(id) as CameraRow | null;
    return r ? fromRow(r) : undefined;
  }

  require(id: string): CameraRecord {
    const c = this.get(id);
    if (!c) throw new HttpError(404, "Camera not found");
    return c;
  }

  count(): number {
    return (this.db.query("SELECT COUNT(*) AS n FROM cameras").get() as { n: number }).n;
  }

  create(input: {
    name: string;
    brand: string;
    built: BuiltSource;
    fields: Record<string, string>;
    defaultSensitivity: number;
    id?: string;
    recordingMode?: RecordingMode;
  }): CameraRecord {
    const id = input.id ?? newId(8);
    const streamKey = isPush(input.built.kind) ? `${id}_${randomToken(9).replace(/[^A-Za-z0-9]/g, "x")}` : id;
    const order = (this.db.query("SELECT COALESCE(MAX(ord), -1) + 1 AS n FROM cameras").get() as { n: number }).n;
    const caps = {
      twoWayAudio: !!input.built.twoWayAudio,
      ptz: false,
      ptzPort: input.built.ptzPort,
      extra: input.built.extra ?? [],
    };
    this.db
      .query(
        `INSERT INTO cameras(id, name, brand, kind, fields_json, url, sub_url, ord, recording_mode, sensitivity, caps_json, stream_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name || "Camera",
        input.brand,
        input.built.kind,
        JSON.stringify(input.fields),
        input.built.url,
        input.built.subUrl ?? null,
        order,
        input.recordingMode ?? "continuous",
        clamp(input.defaultSensitivity, 1, 10),
        JSON.stringify(caps),
        streamKey,
        Date.now(),
      );
    this.changed();
    return this.get(id)!;
  }

  update(id: string, body: Record<string, unknown>): CameraRecord {
    const cam = this.require(id);
    const sets: string[] = [];
    const vals: (string | number | null)[] = [];
    const set = (col: string, v: string | number | null) => {
      sets.push(`${col} = ?`);
      vals.push(v);
    };
    if (body.name !== undefined) set("name", str(body.name, "name", { max: 80 }).trim() || cam.name);
    if (body.group !== undefined) set("grp", str(body.group, "group", { max: 80 }) || null);
    if (body.order !== undefined) set("ord", Math.round(Number(body.order)) || 0);
    if (body.enabled !== undefined) set("enabled", body.enabled ? 1 : 0);
    if (isPlainObject(body.recording)) {
      const r = body.recording;
      if (r.mode !== undefined) {
        if (!["continuous", "motion", "off"].includes(String(r.mode))) throw new HttpError(400, "Invalid recording mode");
        set("recording_mode", String(r.mode));
      }
      if (r.useSubstream !== undefined) set("use_substream", r.useSubstream ? 1 : 0);
    }
    if (isPlainObject(body.motion)) {
      const m = body.motion;
      if (m.enabled !== undefined) set("motion_enabled", m.enabled ? 1 : 0);
      if (m.sensitivity !== undefined) set("sensitivity", clamp(Math.round(Number(m.sensitivity)) || 5, 1, 10));
      if (m.notify !== undefined) set("notify", m.notify ? 1 : 0);
    }
    const hasSource = isPlainObject(body.fields) || body.url !== undefined || body.subUrl !== undefined;
    if (hasSource && cam.kind !== "demo") {
      const input = normalizeInput({ brand: cam.brand, kind: cam.kind, fields: body.fields ?? {}, url: body.url, subUrl: body.subUrl, name: cam.name });
      const fields = unmaskFields({ ...cam.fields, ...input.fields }, cam.fields);
      const built = buildSource(cam.brand, isPush(cam.kind) ? cam.kind : fields.kind || (cam.brand === "generic" ? undefined : cam.kind), fields);
      set("fields_json", JSON.stringify(fields));
      set("url", built.url);
      set("sub_url", built.subUrl ?? null);
      set("kind", built.kind);
      set("caps_json", JSON.stringify({ ...cam.caps, twoWayAudio: !!built.twoWayAudio, ptzPort: built.ptzPort ?? cam.caps.ptzPort, extra: built.extra ?? [] }));
    }
    if (sets.length) {
      this.db.query(`UPDATE cameras SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
      this.changed();
    }
    return this.get(id)!;
  }

  setCaps(id: string, caps: Partial<CameraRecord["caps"]>): void {
    const cam = this.get(id);
    if (!cam) return;
    this.db.query("UPDATE cameras SET caps_json = ? WHERE id = ?").run(JSON.stringify({ ...cam.caps, ...caps }), id);
  }

  delete(id: string): void {
    this.require(id);
    this.db.query("DELETE FROM cameras WHERE id = ?").run(id);
    this.changed();
  }

  reorder(ids: string[]): void {
    const tx = this.db.transaction(() => {
      ids.forEach((id, i) => this.db.query("UPDATE cameras SET ord = ? WHERE id = ?").run(i, id));
    });
    tx();
    this.changed();
  }
}

export function cameraJson(c: CameraRecord, status: CameraStatus, pushBase?: { rtsp: string; rtmp: string }): CameraJson {
  const out: CameraJson = {
    id: c.id,
    name: c.name,
    brand: c.brand,
    group: c.group,
    order: c.order,
    enabled: c.enabled,
    source: { kind: c.kind, url: c.kind === "demo" ? "demo://" + c.name.toLowerCase().replace(/\s+/g, "-") : maskUrl(c.url), subUrl: c.subUrl ? maskUrl(c.subUrl) : undefined },
    fields: c.kind === "demo" ? {} : maskFields(c.brand, c.fields),
    recording: { mode: c.recordingMode, useSubstream: c.useSubstream },
    motion: { enabled: c.motionEnabled, sensitivity: c.sensitivity, notify: c.notify },
    capabilities: {
      audio: !!c.caps.audio,
      twoWayAudio: !!c.caps.twoWayAudio,
      ptz: !!c.caps.ptz,
      substream: !!c.subUrl,
      ptzPresets: c.caps.ptz ? c.caps.ptzPresets ?? [] : undefined,
    },
    status,
    createdAt: toIso(c.createdAt),
  };
  if (isPush(c.kind) && pushBase) out.push = { url: c.kind === "rtmp-push" ? `${pushBase.rtmp}/${c.streamKey}` : `${pushBase.rtsp}/${c.streamKey}` };
  return out;
}
