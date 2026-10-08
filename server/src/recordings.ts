import type { DB } from "./db.ts";
import { HttpError, newId, toIso } from "./util.ts";

export type RecordingRow = {
  id: string;
  camera_id: string;
  start_ms: number;
  end_ms: number;
  duration: number;
  size: number;
  path: string | null;
  thumb_path: string | null;
  state: "pending" | "kept";
  created_at: number;
};

export type RecordingJson = {
  id: string;
  cameraId: string;
  start: string;
  end: string;
  durationSec: number;
  sizeBytes: number;
  location: "local" | "remote" | "both";
  uploaded: boolean;
  motion: boolean;
  videoUrl: string;
  thumbUrl: string;
};

export type EventRow = { id: string; camera_id: string; start_ms: number; end_ms: number | null; score: number; snapshot_path: string | null };

export type MotionEventJson = {
  id: string;
  cameraId: string;
  start: string;
  end?: string;
  score: number;
  snapshotUrl: string;
  recordingId?: string;
  offsetSec?: number;
};

const REC_COLS = `r.*,
  EXISTS(SELECT 1 FROM uploads u WHERE u.recording_id = r.id AND u.status = 'done') AS uploaded,
  EXISTS(SELECT 1 FROM events e WHERE e.camera_id = r.camera_id AND e.start_ms < r.end_ms AND COALESCE(e.end_ms, 9000000000000000) > r.start_ms) AS motion`;

type RecQueryRow = RecordingRow & { uploaded: number; motion: number };

export function recordingJson(r: RecQueryRow): RecordingJson {
  const uploaded = !!r.uploaded;
  return {
    id: r.id,
    cameraId: r.camera_id,
    start: toIso(r.start_ms),
    end: toIso(r.end_ms),
    durationSec: Math.round(r.duration * 10) / 10,
    sizeBytes: r.size,
    location: r.path ? (uploaded ? "both" : "local") : "remote",
    uploaded,
    motion: !!r.motion,
    videoUrl: `/api/recordings/${r.id}/video.mp4`,
    thumbUrl: `/api/recordings/${r.id}/thumb.jpg`,
  };
}

export function eventJson(e: EventRow, rec?: { id: string; start_ms: number }): MotionEventJson {
  return {
    id: e.id,
    cameraId: e.camera_id,
    start: toIso(e.start_ms),
    end: e.end_ms ? toIso(e.end_ms) : undefined,
    score: Math.round(e.score * 1000) / 1000,
    snapshotUrl: `/api/events/${e.id}/snapshot.jpg`,
    recordingId: rec?.id,
    offsetSec: rec ? Math.max(0, Math.round((e.start_ms - rec.start_ms) / 100) / 10) : undefined,
  };
}

export class Recordings {
  constructor(private db: DB) {}

  insert(r: Omit<RecordingRow, "id" | "created_at">): RecordingRow {
    const id = newId(12);
    this.db
      .query(
        "INSERT INTO recordings(id, camera_id, start_ms, end_ms, duration, size, path, thumb_path, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, r.camera_id, r.start_ms, r.end_ms, r.duration, r.size, r.path, r.thumb_path, r.state, Date.now());
    return this.get(id)!;
  }

  get(id: string): RecordingRow | undefined {
    return (this.db.query("SELECT * FROM recordings WHERE id = ?").get(id) as RecordingRow | null) ?? undefined;
  }

  require(id: string): RecordingRow {
    const r = this.get(id);
    if (!r) throw new HttpError(404, "Recording not found");
    return r;
  }

  json(id: string): RecordingJson | undefined {
    const r = this.db.query(`SELECT ${REC_COLS} FROM recordings r WHERE r.id = ?`).get(id) as RecQueryRow | null;
    return r ? recordingJson(r) : undefined;
  }

  hasPath(path: string): boolean {
    return !!this.db.query("SELECT 1 FROM recordings WHERE path = ?").get(path);
  }

  list(q: { camera?: string; from?: number; to?: number; limit: number; cursor?: string; cameras?: string[] }): { items: RecordingJson[]; nextCursor?: string } {
    const where: string[] = ["r.state = 'kept'"];
    const args: (string | number)[] = [];
    if (q.camera) {
      where.push("r.camera_id = ?");
      args.push(q.camera);
    }
    if (q.from !== undefined) {
      where.push("r.end_ms > ?");
      args.push(q.from);
    }
    if (q.to !== undefined) {
      where.push("r.start_ms < ?");
      args.push(q.to);
    }
    if (q.cursor) {
      const [ms, id] = q.cursor.split("_");
      where.push("(r.start_ms < ? OR (r.start_ms = ? AND r.id < ?))");
      args.push(Number(ms), Number(ms), id ?? "");
    }
    const rows = this.db
      .query(`SELECT ${REC_COLS} FROM recordings r WHERE ${where.join(" AND ")} ORDER BY r.start_ms DESC, r.id DESC LIMIT ?`)
      .all(...args, q.limit + 1) as RecQueryRow[];
    const more = rows.length > q.limit;
    const items = rows.slice(0, q.limit).map(recordingJson);
    const last = rows[q.limit - 1];
    return { items, nextCursor: more && last ? `${last.start_ms}_${last.id}` : undefined };
  }

  ranges(camera: string, from: number, to: number): { start: string; end: string; recordingId: string }[] {
    const rows = this.db
      .query("SELECT id, start_ms, end_ms FROM recordings WHERE camera_id = ? AND state = 'kept' AND end_ms > ? AND start_ms < ? ORDER BY start_ms")
      .all(camera, from, to) as { id: string; start_ms: number; end_ms: number }[];
    return rows.map((r) => ({ start: toIso(r.start_ms), end: toIso(r.end_ms), recordingId: r.id }));
  }

  startTimes(camera: string): number[] {
    return (this.db.query("SELECT start_ms FROM recordings WHERE camera_id = ? AND state = 'kept'").all(camera) as { start_ms: number }[]).map((r) => r.start_ms);
  }

  covering(camera: string, at: number): { id: string; start_ms: number } | undefined {
    return (
      (this.db
        .query("SELECT id, start_ms FROM recordings WHERE camera_id = ? AND state = 'kept' AND start_ms <= ? AND end_ms > ? ORDER BY start_ms DESC LIMIT 1")
        .get(camera, at, at) as { id: string; start_ms: number } | null) ?? undefined
    );
  }

  overlapping(camera: string, from: number, to: number): RecordingRow[] {
    return this.db.query("SELECT * FROM recordings WHERE camera_id = ? AND state = 'kept' AND end_ms > ? AND start_ms < ? ORDER BY start_ms").all(camera, from, to) as RecordingRow[];
  }

  setState(id: string, state: "pending" | "kept"): void {
    this.db.query("UPDATE recordings SET state = ? WHERE id = ?").run(state, id);
  }

  pending(): RecordingRow[] {
    return this.db.query("SELECT * FROM recordings WHERE state = 'pending' ORDER BY start_ms").all() as RecordingRow[];
  }

  setThumb(id: string, rel: string | null): void {
    this.db.query("UPDATE recordings SET thumb_path = ? WHERE id = ?").run(rel, id);
  }

  clearLocal(id: string): void {
    this.db.query("UPDATE recordings SET path = NULL WHERE id = ?").run(id);
  }

  remove(id: string): void {
    this.db.query("DELETE FROM recordings WHERE id = ?").run(id);
  }

  stats(): { count: number; bytes: number } {
    const r = this.db.query("SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM recordings WHERE path IS NOT NULL").get() as { count: number; bytes: number };
    return r;
  }

  countAll(): number {
    return (this.db.query("SELECT COUNT(*) AS n FROM recordings WHERE state = 'kept'").get() as { n: number }).n;
  }

  // events

  insertEvent(e: EventRow): void {
    this.db.query("INSERT INTO events(id, camera_id, start_ms, end_ms, score, snapshot_path) VALUES (?, ?, ?, ?, ?, ?)").run(e.id, e.camera_id, e.start_ms, e.end_ms, e.score, e.snapshot_path);
  }

  updateEvent(id: string, endMs: number | null, score: number): void {
    this.db.query("UPDATE events SET end_ms = ?, score = MAX(score, ?) WHERE id = ?").run(endMs, score, id);
  }

  setEventSnapshot(id: string, path: string): void {
    this.db.query("UPDATE events SET snapshot_path = ? WHERE id = ?").run(path, id);
  }

  getEvent(id: string): EventRow | undefined {
    return (this.db.query("SELECT * FROM events WHERE id = ?").get(id) as EventRow | null) ?? undefined;
  }

  eventJsonFor(e: EventRow): MotionEventJson {
    return eventJson(e, this.covering(e.camera_id, e.start_ms));
  }

  events(q: { camera?: string; from?: number; before?: number; to?: number; limit: number; cursor?: string }): { items: MotionEventJson[]; nextCursor?: string } {
    const where: string[] = ["1 = 1"];
    const args: (string | number)[] = [];
    if (q.camera) {
      where.push("camera_id = ?");
      args.push(q.camera);
    }
    if (q.from !== undefined) {
      where.push("COALESCE(end_ms, start_ms) >= ?");
      args.push(q.from);
    }
    if (q.to !== undefined) {
      where.push("start_ms < ?");
      args.push(q.to);
    }
    if (q.before !== undefined) {
      where.push("start_ms < ?");
      args.push(q.before);
    }
    if (q.cursor) {
      const [ms, id] = q.cursor.split("_");
      where.push("(start_ms < ? OR (start_ms = ? AND id < ?))");
      args.push(Number(ms), Number(ms), id ?? "");
    }
    const rows = this.db.query(`SELECT * FROM events WHERE ${where.join(" AND ")} ORDER BY start_ms DESC, id DESC LIMIT ?`).all(...args, q.limit + 1) as EventRow[];
    const more = rows.length > q.limit;
    const items = rows.slice(0, q.limit).map((e) => this.eventJsonFor(e));
    const last = rows[q.limit - 1];
    return { items, nextCursor: more && last ? `${last.start_ms}_${last.id}` : undefined };
  }

  eventsOverlapping(camera: string, from: number, to: number): EventRow[] {
    return this.db
      .query("SELECT * FROM events WHERE camera_id = ? AND start_ms < ? AND COALESCE(end_ms, ?) > ? ORDER BY start_ms")
      .all(camera, to, Date.now(), from) as EventRow[];
  }

  openEvents(camera: string): EventRow[] {
    return this.db.query("SELECT * FROM events WHERE camera_id = ? AND end_ms IS NULL").all(camera) as EventRow[];
  }

  daysWithFootage(camera: string, tz: string): string[] {
    const rows = this.db
      .query("SELECT DISTINCT (start_ms / 3600000) AS h FROM recordings WHERE camera_id = ? AND state = 'kept' ORDER BY h DESC LIMIT 20000")
      .all(camera) as { h: number }[];
    const fmt = dayFormatter(tz);
    const days = new Set<string>();
    for (const r of rows) {
      days.add(fmt.format(new Date(r.h * 3600000)));
      days.add(fmt.format(new Date(r.h * 3600000 + 3599999)));
    }
    return [...days].sort().reverse();
  }
}

export function dayFormatter(tz: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
  }
}

export function tzOffsetMs(tz: string, at: number): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = Object.fromEntries(dtf.formatToParts(new Date(at)).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    return asUtc - Math.floor(at / 1000) * 1000;
  } catch {
    return 0;
  }
}

export function dayBounds(day: string, tz: string): { from: number; to: number } {
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new HttpError(400, "day must be YYYY-MM-DD");
  const utcMidnight = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const from = utcMidnight - tzOffsetMs(tz, utcMidnight - tzOffsetMs(tz, utcMidnight));
  const nextUtc = utcMidnight + 86400000;
  const to = nextUtc - tzOffsetMs(tz, nextUtc - tzOffsetMs(tz, nextUtc));
  return { from, to };
}
