import type { DB } from "./db.ts";
import { HttpError } from "./util.ts";
import { logger, errMsg } from "./log.ts";

const log = logger("push");
const EXPO_URL = "https://exp.host/--/api/v2/push/send";

type TokenRow = { token: string; user_id: string; platform: string | null; cameras_json: string | null; server: string | null };

export function validExpoToken(t: unknown): t is string {
  return typeof t === "string" && /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(t);
}

export class Push {
  private lastSent = new Map<string, number>();

  constructor(private db: DB, private sendImpl: (body: unknown) => Promise<unknown> = defaultSend) {}

  register(userId: string, token: unknown, platform?: unknown, cameras?: unknown, server?: string): void {
    if (!validExpoToken(token)) throw new HttpError(400, "Invalid Expo push token");
    const cams = Array.isArray(cameras) ? cameras.filter((c) => typeof c === "string") : null;
    this.db
      .query(
        `INSERT INTO push_tokens(token, user_id, platform, cameras_json, created_at, server) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, cameras_json = excluded.cameras_json, server = excluded.server`,
      )
      .run(token, userId, typeof platform === "string" ? platform.slice(0, 20) : null, cams ? JSON.stringify(cams) : null, Date.now(), server?.slice(0, 300) ?? null);
  }

  unregister(token: unknown): void {
    if (typeof token === "string") this.db.query("DELETE FROM push_tokens WHERE token = ?").run(token);
  }

  count(): number {
    return (this.db.query("SELECT COUNT(*) AS n FROM push_tokens").get() as { n: number }).n;
  }

  allowed(cameraId: string, cooldownSec: number, now = Date.now()): boolean {
    const last = this.lastSent.get(cameraId) ?? 0;
    if (now - last < cooldownSec * 1000) return false;
    this.lastSent.set(cameraId, now);
    return true;
  }

  async notifyMotion(opts: { cameraId: string; cameraName: string; eventId: string; serverName: string; cooldownSec: number; at: number; publicUrl?: string }): Promise<number> {
    if (!this.allowed(opts.cameraId, opts.cooldownSec)) return 0;
    const rows = this.db.query("SELECT * FROM push_tokens").all() as TokenRow[];
    const targets = rows.filter((r) => {
      if (!r.cameras_json) return true;
      try {
        return (JSON.parse(r.cameras_json) as string[]).includes(opts.cameraId);
      } catch {
        return true;
      }
    });
    if (!targets.length) return 0;
    const messages = targets.map((t) => ({
      to: t.token,
      title: opts.cameraName,
      body: "Motion detected",
      sound: "default",
      priority: "high",
      channelId: "motion",
      data: {
        type: "motion",
        cameraId: opts.cameraId,
        eventId: opts.eventId,
        start: new Date(opts.at).toISOString(),
        server: t.server ?? opts.publicUrl,
        serverName: opts.serverName,
      },
    }));
    let sent = 0;
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      try {
        const res = (await this.sendImpl(batch)) as { data?: { status: string; details?: { error?: string } }[] };
        res.data?.forEach((r, idx) => {
          if (r.status === "ok") sent++;
          else if (r.details?.error === "DeviceNotRegistered") this.unregister(batch[idx]!.to);
        });
      } catch (e) {
        log.warn(`push failed: ${errMsg(e)}`);
      }
    }
    return sent;
  }
}

async function defaultSend(body: unknown): Promise<unknown> {
  const res = await fetch(EXPO_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "accept-encoding": "gzip, deflate" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Expo push HTTP ${res.status}`);
  return res.json();
}
