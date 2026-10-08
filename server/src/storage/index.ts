import { existsSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { DB } from "../db.ts";
import type { Bus } from "../bus.ts";
import { HttpError, MASK, isPlainObject, newId, str, toIso } from "../util.ts";
import { logger, errMsg } from "../log.ts";
import { Rclone, rcloneError } from "./rclone.ts";
import { TARGET_TYPES, remoteBase, typeInfo, validateConfig, type TargetType } from "./types.ts";

const log = logger("storage");

type TargetRow = {
  id: string;
  type: TargetType;
  name: string;
  enabled: number;
  config_json: string;
  path: string;
  retention_days: number;
  last_upload: number | null;
  last_error: string | null;
  used_bytes: number | null;
  created_at: number;
};

export type Target = {
  id: string;
  type: TargetType;
  name: string;
  enabled: boolean;
  config: Record<string, string>;
  path: string;
  retentionDays: number;
  lastUpload?: number;
  lastError?: string;
  usedBytes?: number;
};

export type TargetJson = {
  id: string;
  type: TargetType;
  name: string;
  enabled: boolean;
  config: Record<string, string>;
  path: string;
  retentionDays: number;
  status: { ok: boolean; lastUpload?: string; usedBytes?: number; queued: number; failed: number; error?: string };
};

type UploadRow = { recording_id: string; target_id: string; status: string; remote_path: string; attempts: number; error: string | null; next_try_at: number };

const fromRow = (r: TargetRow): Target => ({
  id: r.id,
  type: r.type,
  name: r.name,
  enabled: !!r.enabled,
  config: JSON.parse(r.config_json),
  path: r.path,
  retentionDays: r.retention_days,
  lastUpload: r.last_upload ?? undefined,
  lastError: r.last_error ?? undefined,
  usedBytes: r.used_bytes ?? undefined,
});

export function maskConfig(type: TargetType, config: Record<string, string>): Record<string, string> {
  const secrets = new Set(typeInfo(type).secrets);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(config)) out[k] = secrets.has(k) && v ? MASK : v;
  return out;
}

export function slug(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .toLowerCase()
      .slice(0, 40) || "camera"
  );
}

export function remoteRecordingPath(cameraName: string, cameraId: string, startMs: number): string {
  const iso = new Date(startMs).toISOString();
  return `${slug(cameraName)}_${cameraId}/${iso.slice(0, 10)}/${iso.slice(11, 19).replace(/:/g, "")}.mp4`;
}

export type StorageDeps = {
  db: DB;
  bus: Bus;
  recordingsDir: string;
  thumbsDir: string;
  rclone: Rclone;
  deleteLocalAfterUpload: () => boolean;
  onLocalDeleted?: (recordingId: string) => void;
};

export class Storage {
  private active = 0;
  private timer?: ReturnType<typeof setInterval>;
  private retentionTimer?: ReturnType<typeof setInterval>;
  readonly concurrency = 2;
  private db: DB;

  constructor(private d: StorageDeps) {
    this.db = d.db;
  }

  get rclone(): Rclone {
    return this.d.rclone;
  }

  async start(): Promise<void> {
    this.db.query("UPDATE uploads SET status = 'queued' WHERE status = 'uploading'").run();
    for (const t of this.list()) {
      try {
        await this.d.rclone.writeConfig(t.id, t.type, t.config);
      } catch (e) {
        log.warn(`config for ${t.name}: ${errMsg(e)}`);
      }
    }
    this.timer = setInterval(() => this.pump(), 3000);
    this.retentionTimer = setInterval(() => void this.remoteRetention(), 60 * 60_000);
    setTimeout(() => void this.remoteRetention(), 60_000);
  }

  stop(): void {
    clearInterval(this.timer);
    clearInterval(this.retentionTimer);
  }

  types() {
    return TARGET_TYPES.map(({ secrets: _s, ...rest }) => rest);
  }

  list(): Target[] {
    return (this.db.query("SELECT * FROM storage_targets ORDER BY created_at").all() as TargetRow[]).map(fromRow);
  }

  get(id: string): Target | undefined {
    const r = this.db.query("SELECT * FROM storage_targets WHERE id = ?").get(id) as TargetRow | null;
    return r ? fromRow(r) : undefined;
  }

  require(id: string): Target {
    const t = this.get(id);
    if (!t) throw new HttpError(404, "Storage target not found");
    return t;
  }

  json(t: Target): TargetJson {
    const counts = this.db
      .query("SELECT SUM(status IN ('queued','uploading')) AS queued, SUM(status = 'failed') AS failed FROM uploads WHERE target_id = ?")
      .get(t.id) as { queued: number | null; failed: number | null };
    return {
      id: t.id,
      type: t.type,
      name: t.name,
      enabled: t.enabled,
      config: maskConfig(t.type, t.config),
      path: t.path,
      retentionDays: t.retentionDays,
      status: {
        ok: !t.lastError,
        lastUpload: t.lastUpload ? toIso(t.lastUpload) : undefined,
        usedBytes: t.usedBytes,
        queued: counts.queued ?? 0,
        failed: counts.failed ?? 0,
        error: t.lastError,
      },
    };
  }

  parseInput(body: Record<string, unknown>, prev?: Target) {
    const type = (prev?.type ?? str(body.type, "type", { required: true })) as TargetType;
    typeInfo(type);
    const config: Record<string, string> = { ...(prev?.config ?? {}) };
    if (isPlainObject(body.config)) {
      for (const [k, v] of Object.entries(body.config)) {
        if (v === undefined || v === null) continue;
        const s = String(v);
        if (s === MASK && prev?.config[k] !== undefined) continue;
        config[k] = s.slice(0, 20000);
      }
    }
    const name = body.name !== undefined ? str(body.name, "name", { max: 80 }).trim() : prev?.name ?? "";
    const path = body.path !== undefined ? str(body.path, "path", { max: 300 }).trim() : prev?.path ?? "OpenCCTV";
    const retentionDays = body.retentionDays !== undefined ? Math.max(0, Math.min(3650, Math.round(Number(body.retentionDays)) || 0)) : prev?.retentionDays ?? 30;
    const enabled = body.enabled !== undefined ? !!body.enabled : prev?.enabled ?? true;
    validateConfig(type, config);
    return { type, config, name: name || typeInfo(type).name, path: path || "OpenCCTV", retentionDays, enabled };
  }

  async create(body: Record<string, unknown>): Promise<Target> {
    const input = this.parseInput(body);
    const id = newId(8);
    await this.d.rclone.writeConfig(id, input.type, input.config);
    this.db
      .query("INSERT INTO storage_targets(id, type, name, enabled, config_json, path, retention_days, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, input.type, input.name, input.enabled ? 1 : 0, JSON.stringify(input.config), input.path, input.retentionDays, Date.now());
    const t = this.require(id);
    this.emit(t);
    return t;
  }

  async update(id: string, body: Record<string, unknown>): Promise<Target> {
    const prev = this.require(id);
    const input = this.parseInput(body, prev);
    await this.d.rclone.writeConfig(id, input.type, input.config);
    this.db
      .query("UPDATE storage_targets SET name = ?, enabled = ?, config_json = ?, path = ?, retention_days = ?, last_error = NULL WHERE id = ?")
      .run(input.name, input.enabled ? 1 : 0, JSON.stringify(input.config), input.path, input.retentionDays, id);
    const t = this.require(id);
    this.emit(t);
    return t;
  }

  delete(id: string): void {
    this.require(id);
    this.db.query("DELETE FROM storage_targets WHERE id = ?").run(id);
    this.db.query("DELETE FROM uploads WHERE target_id = ?").run(id);
    this.d.rclone.removeConfig(id);
  }

  async test(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
    const prev = typeof body.id === "string" ? this.get(body.id) : undefined;
    const input = this.parseInput(body, prev);
    const id = `test-${newId(6)}`;
    try {
      await this.d.rclone.writeConfig(id, input.type, input.config);
      const base = remoteBase(input.type, input.config, input.path);
      const probe = `${base ? base + "/" : ""}.opencctv-test-${newId(6)}`;
      const r = await this.d.rclone.exec(id, ["rcat", `t:${probe}`], { stdin: "opencctv", timeoutMs: 45_000 });
      if (r.code !== 0) return { ok: false, error: rcloneError(r.stderr) };
      await this.d.rclone.exec(id, ["deletefile", `t:${probe}`], { timeoutMs: 30_000 });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    } finally {
      this.d.rclone.removeConfig(id);
    }
  }

  private emit(t: Target) {
    this.d.bus.emit({ type: "storage", target: this.json(t) });
  }

  enqueue(rec: { id: string; start_ms: number }, camera: { id: string; name: string }): void {
    const now = Date.now();
    for (const t of this.list()) {
      if (!t.enabled) continue;
      const remote = remoteRecordingPath(camera.name, camera.id, rec.start_ms);
      this.db
        .query("INSERT OR IGNORE INTO uploads(recording_id, target_id, status, remote_path, updated_at) VALUES (?, ?, 'queued', ?, ?)")
        .run(rec.id, t.id, remote, now);
    }
    this.pump();
  }

  private pump(): void {
    if (!this.d.rclone.available) return;
    while (this.active < this.concurrency) {
      const row = this.db
        .query(
          `SELECT u.* FROM uploads u JOIN storage_targets t ON t.id = u.target_id
           WHERE u.status = 'queued' AND u.next_try_at <= ? AND t.enabled = 1 ORDER BY u.updated_at LIMIT 1`,
        )
        .get(Date.now()) as UploadRow | null;
      if (!row) return;
      this.db.query("UPDATE uploads SET status = 'uploading', updated_at = ? WHERE recording_id = ? AND target_id = ?").run(Date.now(), row.recording_id, row.target_id);
      this.active++;
      void this.upload(row).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  private async upload(u: UploadRow): Promise<void> {
    const rec = this.db.query("SELECT path FROM recordings WHERE id = ?").get(u.recording_id) as { path: string | null } | null;
    const t = this.get(u.target_id);
    if (!rec || !t) {
      this.db.query("DELETE FROM uploads WHERE recording_id = ? AND target_id = ?").run(u.recording_id, u.target_id);
      return;
    }
    if (!rec.path) {
      this.db.query("UPDATE uploads SET status = 'failed', error = 'local file missing' WHERE recording_id = ? AND target_id = ?").run(u.recording_id, u.target_id);
      return;
    }
    const local = join(this.d.recordingsDir, rec.path);
    const base = remoteBase(t.type, t.config, t.path);
    const dest = `t:${base ? base + "/" : ""}${u.remote_path}`;
    const r = await this.d.rclone.exec(t.id, ["copyto", local, dest, "--retries", "2", "--low-level-retries", "5", "--stats", "0"], { timeoutMs: 30 * 60_000 });
    const now = Date.now();
    if (r.code === 0) {
      this.db.query("UPDATE uploads SET status = 'done', error = NULL, attempts = attempts + 1, updated_at = ? WHERE recording_id = ? AND target_id = ?").run(now, u.recording_id, u.target_id);
      this.db.query("UPDATE storage_targets SET last_upload = ?, last_error = NULL WHERE id = ?").run(now, t.id);
      log.debug(`uploaded ${rec.path} to ${t.name}`);
      this.maybeDeleteLocal(u.recording_id);
    } else {
      const err = rcloneError(r.stderr);
      const attempts = u.attempts + 1;
      const status = attempts >= 10 ? "failed" : "queued";
      const delay = Math.min(60 * 60_000, 30_000 * 2 ** (attempts - 1));
      this.db
        .query("UPDATE uploads SET status = ?, error = ?, attempts = ?, next_try_at = ?, updated_at = ? WHERE recording_id = ? AND target_id = ?")
        .run(status, err, attempts, now + delay, now, u.recording_id, u.target_id);
      this.db.query("UPDATE storage_targets SET last_error = ? WHERE id = ?").run(err, t.id);
      log.warn(`upload to ${t.name} failed (attempt ${attempts}): ${err}`);
    }
    const fresh = this.get(t.id);
    if (fresh) this.emit(fresh);
  }

  private maybeDeleteLocal(recordingId: string) {
    if (!this.d.deleteLocalAfterUpload()) return;
    const pending = this.db
      .query(
        `SELECT COUNT(*) AS n FROM storage_targets t WHERE t.enabled = 1 AND NOT EXISTS
         (SELECT 1 FROM uploads u WHERE u.target_id = t.id AND u.recording_id = ? AND u.status = 'done')`,
      )
      .get(recordingId) as { n: number };
    if (pending.n > 0) return;
    const rec = this.db.query("SELECT path FROM recordings WHERE id = ?").get(recordingId) as { path: string | null } | null;
    if (!rec?.path) return;
    try {
      unlinkSync(join(this.d.recordingsDir, rec.path));
    } catch {}
    this.db.query("UPDATE recordings SET path = NULL WHERE id = ?").run(recordingId);
    this.d.onLocalDeleted?.(recordingId);
  }

  remoteCopy(recordingId: string): { target: Target; remotePath: string } | undefined {
    const rows = this.db
      .query("SELECT * FROM uploads WHERE recording_id = ? AND status = 'done'")
      .all(recordingId) as UploadRow[];
    for (const u of rows) {
      const t = this.get(u.target_id);
      if (t) {
        const base = remoteBase(t.type, t.config, t.path);
        return { target: t, remotePath: `${base ? base + "/" : ""}${u.remote_path}` };
      }
    }
    return undefined;
  }

  streamRemote(recordingId: string, size: number, range?: { start: number; end: number }): Response {
    const copy = this.remoteCopy(recordingId);
    if (!copy) throw new HttpError(404, "Recording is not available");
    const start = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    const proc = this.d.rclone.spawnCat(copy.target.id, copy.remotePath, start, end - start + 1);
    const headers = new Headers({ "content-type": "video/mp4", "accept-ranges": "bytes", "content-length": String(end - start + 1), "cache-control": "private, max-age=3600" });
    if (range) headers.set("content-range", `bytes ${start}-${end}/${size}`);
    return new Response(proc.stdout, { status: range ? 206 : 200, headers });
  }

  async deleteRemoteCopies(recordingId: string): Promise<void> {
    const rows = this.db.query("SELECT * FROM uploads WHERE recording_id = ? AND status = 'done'").all(recordingId) as UploadRow[];
    for (const u of rows) {
      const t = this.get(u.target_id);
      if (!t) continue;
      const base = remoteBase(t.type, t.config, t.path);
      await this.d.rclone.exec(t.id, ["deletefile", `t:${base ? base + "/" : ""}${u.remote_path}`], { timeoutMs: 60_000 }).catch(() => undefined);
    }
    this.db.query("DELETE FROM uploads WHERE recording_id = ?").run(recordingId);
  }

  async remoteRetention(now = Date.now()): Promise<void> {
    if (!this.d.rclone.available) return;
    for (const t of this.list()) {
      if (!t.enabled || t.retentionDays <= 0) continue;
      const base = remoteBase(t.type, t.config, t.path);
      if (!base || base === "/" || /^[a-zA-Z]:\/?$/.test(base)) {
        log.warn(`skipping retention for ${t.name}: refusing to clean the root of the target`);
        continue;
      }
      try {
        const del = await this.d.rclone.exec(t.id, ["delete", `t:${base}`, "--min-age", `${t.retentionDays}d`, "--include", "*.mp4"], { timeoutMs: 30 * 60_000 });
        if (del.code !== 0 && !/directory not found/i.test(del.stderr)) log.warn(`retention on ${t.name}: ${rcloneError(del.stderr)}`);
        await this.d.rclone.exec(t.id, ["rmdirs", `t:${base}`, "--leave-root"], { timeoutMs: 10 * 60_000 });
        const cutoff = now - t.retentionDays * 86400_000;
        this.db
          .query(
            `UPDATE uploads SET status = 'deleted' WHERE target_id = ? AND status = 'done'
             AND recording_id IN (SELECT id FROM recordings WHERE end_ms < ?)`,
          )
          .run(t.id, cutoff);
        const size = await this.d.rclone.exec(t.id, ["size", `t:${base}`, "--json"], { timeoutMs: 5 * 60_000 });
        if (size.code === 0) {
          const bytes = (JSON.parse(size.stdout) as { bytes?: number }).bytes;
          if (typeof bytes === "number") this.db.query("UPDATE storage_targets SET used_bytes = ? WHERE id = ?").run(bytes, t.id);
        }
      } catch (e) {
        log.warn(`retention on ${t.name}: ${errMsg(e)}`);
      }
    }
    this.pruneOrphans();
  }

  pruneOrphans(): number {
    const rows = this.db
      .query(
        `SELECT id, thumb_path FROM recordings r WHERE r.path IS NULL
         AND NOT EXISTS (SELECT 1 FROM uploads u WHERE u.recording_id = r.id AND u.status IN ('done','queued','uploading'))`,
      )
      .all() as { id: string; thumb_path: string | null }[];
    for (const r of rows) {
      if (r.thumb_path) {
        const p = join(this.d.thumbsDir, r.thumb_path);
        if (existsSync(p)) unlinkSync(p);
      }
      this.db.query("DELETE FROM recordings WHERE id = ?").run(r.id);
    }
    return rows.length;
  }

  hasRemote(recordingId: string): boolean {
    return !!this.db.query("SELECT 1 FROM uploads WHERE recording_id = ? AND status = 'done'").get(recordingId);
  }

  localFileSize(rel: string): number | undefined {
    try {
      return statSync(join(this.d.recordingsDir, rel)).size;
    } catch {
      return undefined;
    }
  }
}
