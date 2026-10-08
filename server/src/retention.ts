import { existsSync, readdirSync, rmdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { DB } from "./db.ts";
import { logger } from "./log.ts";

const log = logger("retention");

export type LocalRec = { id: string; start: number; end: number; size: number };

export function selectLocalDeletions(recs: LocalRec[], opts: { now: number; localDays: number; maxBytes: number }): string[] {
  const sorted = [...recs].sort((a, b) => a.start - b.start);
  const out = new Set<string>();
  if (opts.localDays > 0) {
    const cutoff = opts.now - opts.localDays * 86400_000;
    for (const r of sorted) if (r.end < cutoff) out.add(r.id);
  }
  if (opts.maxBytes > 0) {
    let total = sorted.filter((r) => !out.has(r.id)).reduce((s, r) => s + r.size, 0);
    for (const r of sorted) {
      if (total <= opts.maxBytes) break;
      if (out.has(r.id)) continue;
      out.add(r.id);
      total -= r.size;
    }
  }
  return [...out];
}

export type RetentionDeps = {
  db: DB;
  dataDir: string;
  recordingsDir: string;
  thumbsDir: string;
  eventsDir: string;
  settings: () => { localDays: number; maxLocalGB: number };
  maxRemoteDays: () => number;
  hasRemote: (id: string) => boolean;
};

export function runLocalRetention(d: RetentionDeps, now = Date.now()): { deleted: number; events: number } {
  const s = d.settings();
  const recs = d.db.query("SELECT id, start_ms AS start, end_ms AS end, size FROM recordings WHERE path IS NOT NULL").all() as LocalRec[];
  const ids = selectLocalDeletions(recs, { now, localDays: s.localDays, maxBytes: s.maxLocalGB * 1024 ** 3 });
  let deleted = 0;
  for (const id of ids) {
    const row = d.db.query("SELECT path, thumb_path FROM recordings WHERE id = ?").get(id) as { path: string | null; thumb_path: string | null } | null;
    if (!row?.path) continue;
    try {
      unlinkSync(join(d.recordingsDir, row.path));
    } catch {}
    deleted++;
    if (d.hasRemote(id)) {
      d.db.query("UPDATE recordings SET path = NULL WHERE id = ?").run(id);
    } else {
      if (row.thumb_path) {
        try {
          unlinkSync(join(d.thumbsDir, row.thumb_path));
        } catch {}
      }
      d.db.query("DELETE FROM recordings WHERE id = ?").run(id);
    }
  }
  const keepDays = Math.max(s.localDays, d.maxRemoteDays());
  let events = 0;
  if (keepDays > 0) {
    const cutoff = now - keepDays * 86400_000;
    const old = d.db.query("SELECT id, snapshot_path FROM events WHERE start_ms < ?").all(cutoff) as { id: string; snapshot_path: string | null }[];
    for (const e of old) {
      if (e.snapshot_path) {
        try {
          unlinkSync(join(d.eventsDir, e.snapshot_path));
        } catch {}
      }
      d.db.query("DELETE FROM events WHERE id = ?").run(e.id);
      events++;
    }
  }
  if (s.localDays > 0) removeStrayFiles(d.recordingsDir, now - (s.localDays + 1) * 86400_000, d.db);
  removeEmptyDirs(d.recordingsDir);
  if (deleted || events) log.info(`removed ${deleted} local recordings and ${events} events`);
  return { deleted, events };
}

function removeStrayFiles(root: string, cutoff: number, db: DB) {
  if (!existsSync(root)) return;
  for (const cam of readdirSync(root)) {
    const camDir = join(root, cam);
    if (!statSync(camDir).isDirectory()) continue;
    for (const day of readdirSync(camDir)) {
      const dayDir = join(camDir, day);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !statSync(dayDir).isDirectory()) continue;
      if (Date.parse(day) + 86400_000 > cutoff) continue;
      for (const f of readdirSync(dayDir)) {
        const rel = `${cam}/${day}/${f}`;
        if (db.query("SELECT 1 FROM recordings WHERE path = ?").get(rel)) continue;
        try {
          unlinkSync(join(dayDir, f));
        } catch {}
      }
    }
  }
}

function removeEmptyDirs(root: string) {
  if (!existsSync(root)) return;
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
  for (const cam of readdirSync(root)) {
    const camDir = join(root, cam);
    try {
      if (!statSync(camDir).isDirectory()) continue;
      for (const day of readdirSync(camDir)) {
        if (day === today || day === tomorrow) continue;
        const dd = join(camDir, day);
        if (statSync(dd).isDirectory() && readdirSync(dd).length === 0) rmdirSync(dd);
      }
    } catch {}
  }
}
