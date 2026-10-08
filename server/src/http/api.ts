import { join } from "node:path";
import { platform, arch } from "node:os";
import { VERSION } from "../config.ts";
import { Router, type Ctx } from "./router.ts";
import { HttpError, isPlainObject, json, parseTime, readJson, str, MASK } from "../util.ts";
import { validRole, validatePassword } from "../auth.ts";
import { BRANDS, buildSource, getBrand } from "../brands.ts";
import { normalizeInput, subStreamName, isPush, type CameraRecord } from "../cameras.ts";
import { dayBounds } from "../recordings.ts";
import { recentLogs } from "../log.ts";
import { discover } from "../discovery.ts";
import { hostFromUrl } from "../brands.ts";
import { importUnifi, hostOnly } from "../unifi.ts";
import { parseRange, rewritePlaylist, safeJoin, serveFile } from "./media.ts";
import { VIDEO_RTC_JS, playerHtml } from "../player/page.ts";
import { errMsg } from "../log.ts";

const r = new Router();

const ok = () => json({ ok: true });

function camOf(ctx: Ctx): CameraRecord {
  return ctx.app.cameras.require(ctx.params.id!);
}

function streamFor(cam: CameraRecord, quality: string | null): string {
  if (quality === "sd") return subStreamName(cam) ?? cam.streamKey;
  return cam.streamKey;
}

function limitOf(url: URL, def = 50, max = 500): number {
  const n = Number(url.searchParams.get("limit") ?? def);
  return Math.max(1, Math.min(max, Number.isFinite(n) ? Math.round(n) : def));
}

function knownHosts(ctx: Ctx): Set<string> {
  const s = new Set<string>();
  for (const c of ctx.app.cameras.list()) {
    const h = c.fields.host || hostFromUrl(c.url);
    if (h) s.add(h);
  }
  return s;
}

// info & auth

r.get("/api/info", "public", (ctx) => {
  const { app } = ctx;
  const link = app.gatewayLink();
  const features = ["hls", "webrtc", "mjpeg", "player", "ptz", "timeline", "events", "clips", "push", "gateway", "discovery", "unifi", "storage", "pairing"];
  if (app.gdrive?.capabilities().deviceFlow) features.push("gdrive-device");
  return json({
    name: app.settings.get().serverName,
    version: VERSION,
    setupRequired: ctx.meta.tunnel ? false : app.auth.adminCount() === 0,
    demo: app.cfg.demo,
    features,
    siteId: link?.siteId,
    demoLogin: app.cfg.demo && !ctx.meta.tunnel ? { username: "demo", password: "demo" } : undefined,
  });
});

let setupBusy = false;
r.post("/api/auth/setup", "public", async (ctx) => {
  if (ctx.meta.tunnel) throw new HttpError(403, "Setup must be done on the server itself");
  const b = await readJson<{ username?: string; password?: string; deviceName?: string }>(ctx.req);
  if (setupBusy || ctx.app.auth.adminCount() > 0) throw new HttpError(409, "Setup is already complete");
  setupBusy = true;
  try {
    const user = await ctx.app.auth.createUser(str(b.username, "username", { required: true, max: 64 }), str(b.password, "password", { required: true, max: 256 }), "admin");
    return json({ token: ctx.app.auth.issueToken(user.id, b.deviceName ?? "Web"), user });
  } finally {
    setupBusy = false;
  }
});

r.post("/api/auth/login", "public", async (ctx) => {
  const b = await readJson<{ username?: string; password?: string; deviceName?: string }>(ctx.req);
  const username = str(b.username, "username", { required: true, max: 64 });
  const key = `${ctx.ip}|${username.toLowerCase()}`;
  if (!ctx.app.auth.limiter.check(key) || !ctx.app.auth.limiter.check(`ip:${ctx.ip}`)) throw new HttpError(429, "Too many login attempts. Try again in a few minutes.");
  const user = await ctx.app.auth.verifyPassword(username, str(b.password, "password", { required: true, max: 256 }));
  if (!user) throw new HttpError(401, "Invalid username or password");
  ctx.app.auth.limiter.reset(key);
  return json({ token: ctx.app.auth.issueToken(user.id, typeof b.deviceName === "string" ? b.deviceName : undefined), user });
});

r.post("/api/auth/pair", "public", async (ctx) => {
  const b = await readJson<{ code?: string; deviceName?: string }>(ctx.req);
  if (!ctx.app.auth.limiter.check(`pair:${ctx.ip}`)) throw new HttpError(429, "Too many attempts. Try again later.");
  const res = await ctx.app.auth.redeemPairingCode(str(b.code, "code", { required: true, max: 40 }), typeof b.deviceName === "string" ? b.deviceName : undefined);
  return json(res);
});

r.post("/api/auth/pairing-code", "admin", async (ctx) => {
  if (ctx.user!.via === "tunnel" || ctx.user!.via === "internal") throw new HttpError(400, "Create pairing codes on the gateway or the server itself");
  const b = await readJson<{ role?: string }>(ctx.req);
  const { code, expiresAt } = ctx.app.auth.createPairingCode(ctx.user!.id, validRole(b.role ?? "admin"));
  const url = `opencctv://pair?server=${encodeURIComponent(ctx.base)}&code=${encodeURIComponent(code)}`;
  return json({ code, expiresAt: new Date(expiresAt).toISOString(), url, server: ctx.base });
});

r.get("/api/auth/me", "user", (ctx) => json({ user: ctx.user }));

r.post("/api/auth/logout", "user", (ctx) => {
  if (ctx.token) ctx.app.auth.revokeToken(ctx.token);
  return ok();
});

// users

r.get("/api/users", "admin", (ctx) => json(ctx.app.auth.listUsers()));
r.post("/api/users", "admin", async (ctx) => {
  const b = await readJson<{ username?: string; password?: string; role?: string }>(ctx.req);
  return json(await ctx.app.auth.createUser(str(b.username, "username", { required: true }), str(b.password, "password", { required: true }), validRole(b.role)), { status: 201 });
});
r.patch("/api/users/:id", "admin", async (ctx) => {
  const b = await readJson<{ username?: string; password?: string; role?: string }>(ctx.req);
  if (b.password) validatePassword(b.password);
  return json(
    await ctx.app.auth.updateUser(ctx.params.id!, {
      username: b.username !== undefined ? str(b.username, "username") : undefined,
      password: b.password || undefined,
      role: b.role !== undefined ? validRole(b.role) : undefined,
    }),
  );
});
r.delete("/api/users/:id", "admin", (ctx) => {
  if (ctx.params.id === ctx.user!.id) throw new HttpError(400, "You cannot delete yourself");
  ctx.app.auth.deleteUser(ctx.params.id!);
  return ok();
});

// brands & cameras

r.get("/api/brands", "user", () => json(BRANDS));

r.get("/api/cameras", "user", (ctx) => json(ctx.app.cameras.list().map((c) => ctx.app.cameraJson(c, ctx.base))));
r.get("/api/cameras/:id", "user", (ctx) => json(ctx.app.cameraJson(camOf(ctx), ctx.base)));

r.post("/api/cameras", "admin", async (ctx) => {
  const input = normalizeInput(await readJson(ctx.req));
  const built = buildSource(input.brand, input.kind, input.fields);
  const brand = getBrand(input.brand)!;
  const cam = ctx.app.cameras.create({
    name: input.name || brand.name,
    brand: input.brand,
    built,
    fields: input.fields,
    defaultSensitivity: ctx.app.settings.get().motion.defaultSensitivity,
  });
  return json(ctx.app.cameraJson(cam, ctx.base), { status: 201 });
});

r.post("/api/cameras/test", "admin", async (ctx) => {
  const body = await readJson<Record<string, unknown>>(ctx.req);
  let fields: Record<string, string>;
  let brand: string;
  let kind: string | undefined;
  if (typeof body.id === "string") {
    const cam = ctx.app.cameras.require(body.id);
    const input = normalizeInput({ ...body, brand: cam.brand });
    fields = { ...cam.fields, ...Object.fromEntries(Object.entries(input.fields).filter(([, v]) => v !== MASK)) };
    brand = cam.brand;
    kind = cam.kind;
  } else {
    const input = normalizeInput(body);
    fields = input.fields;
    brand = input.brand;
    kind = input.kind;
  }
  const built = buildSource(brand, kind, fields);
  if (isPush(built.kind)) return json({ ok: true, error: "Push cameras connect to the server after saving" });
  return json(await ctx.app.testCamera([built.url, ...(built.extra ?? [])], built.subUrl));
});

r.post("/api/cameras/reorder", "admin", async (ctx) => {
  const b = await readJson<{ ids?: unknown }>(ctx.req);
  if (!Array.isArray(b.ids) || !b.ids.every((x) => typeof x === "string")) throw new HttpError(400, "ids must be an array of strings");
  ctx.app.cameras.reorder(b.ids as string[]);
  return ok();
});

r.patch("/api/cameras/:id", "admin", async (ctx) => {
  const b = await readJson<Record<string, unknown>>(ctx.req);
  const cam = ctx.app.cameras.update(ctx.params.id!, b);
  return json(ctx.app.cameraJson(cam, ctx.base));
});

r.delete("/api/cameras/:id", "admin", (ctx) => {
  ctx.app.cameras.delete(ctx.params.id!);
  return ok();
});

r.get("/api/cameras/:id/snapshot.jpg", "user", async (ctx) => {
  const cam = camOf(ctx);
  const w = Number(ctx.url.searchParams.get("w") || 0);
  const width = w > 0 ? Math.min(3840, Math.max(64, Math.round(w))) : undefined;
  try {
    const data = await ctx.app.snapshot(cam, width);
    return new Response(data as unknown as BodyInit, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=2" } });
  } catch (e) {
    const last = ctx.app.lastSnapshot(cam.id);
    if (last) return new Response(last as unknown as BodyInit, { headers: { "content-type": "image/jpeg", "cache-control": "no-store", "x-opencctv-stale": "1" } });
    throw new HttpError(503, `Snapshot unavailable: ${errMsg(e)}`);
  }
});

r.get("/api/cameras/:id/live.m3u8", "user", async (ctx) => {
  const cam = camOf(ctx);
  const src = streamFor(cam, ctx.url.searchParams.get("quality"));
  const res = await ctx.app.go2rtc.fetch(`/api/stream.m3u8?src=${encodeURIComponent(src)}&mp4`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new HttpError(502, (await res.text()).trim().slice(0, 200) || "Stream unavailable");
  return new Response(rewritePlaylist(await res.text(), ctx.token), {
    headers: { "content-type": "application/vnd.apple.mpegurl", "cache-control": "no-store" },
  });
});

r.get("/api/cameras/:id/hls/:file", "user", async (ctx) => {
  camOf(ctx);
  const file = ctx.params.file!;
  if (!/^(playlist\.m3u8|init\.mp4|segment\.m4s|segment\.ts|segment\.mp4)$/.test(file)) throw new HttpError(404, "Not found");
  const q = new URLSearchParams(ctx.url.search);
  q.delete("token");
  const res = await ctx.app.go2rtc.fetch(`/api/hls/${file}?${q.toString()}`, { signal: ctx.req.signal });
  const headers = new Headers({ "cache-control": "no-store", "content-type": res.headers.get("content-type") ?? "application/octet-stream" });
  if (file.endsWith(".m3u8")) {
    const text = await res.text();
    return new Response(rewritePlaylist(text, ctx.token), { status: res.status, headers: { ...Object.fromEntries(headers), "content-type": "application/vnd.apple.mpegurl" } });
  }
  return new Response(res.body, { status: res.status, headers });
});

r.get("/api/cameras/:id/mjpeg", "user", async (ctx) => {
  const cam = camOf(ctx);
  const src = streamFor(cam, ctx.url.searchParams.get("quality"));
  const res = await ctx.app.go2rtc.fetch(`/api/stream.mjpeg?src=${encodeURIComponent(src)}`, { signal: ctx.req.signal });
  if (!res.ok || !res.body) throw new HttpError(502, "Stream unavailable");
  return new Response(res.body, { headers: { "content-type": res.headers.get("content-type") ?? "multipart/x-mixed-replace; boundary=frame", "cache-control": "no-store" } });
});

r.post("/api/cameras/:id/webrtc", "user", async (ctx) => {
  const cam = camOf(ctx);
  const b = await readJson<{ sdp?: string; quality?: string }>(ctx.req);
  const sdp = str(b.sdp, "sdp", { required: true, max: 100_000 });
  try {
    return json({ type: "answer", sdp: await ctx.app.go2rtc.webrtc(streamFor(cam, b.quality ?? null), sdp) });
  } catch (e) {
    throw new HttpError(502, errMsg(e));
  }
});

r.get("/api/cameras/:id/ws", "user", (ctx) => {
  const cam = camOf(ctx);
  const src = streamFor(cam, ctx.url.searchParams.get("quality"));
  const target = ctx.app.go2rtc.wsUrl(`/api/ws?src=${encodeURIComponent(src)}`);
  if (ctx.server?.upgrade(ctx.req, { data: { kind: "stream", target, pending: [] } })) return undefined;
  throw new HttpError(400, "WebSocket upgrade required");
});

r.post("/api/cameras/:id/ptz", "user", async (ctx) => {
  const cam = camOf(ctx);
  const t = ctx.app.onvifTarget(cam);
  if (!t) throw new HttpError(400, "PTZ is not available for this camera");
  const b = await readJson<{ action?: string; pan?: number; tilt?: number; zoom?: number; preset?: string }>(ctx.req);
  try {
    if (b.action === "move") await ctx.app.onvif.move(t, Number(b.pan) || 0, Number(b.tilt) || 0, Number(b.zoom) || 0);
    else if (b.action === "stop") await ctx.app.onvif.stop(t);
    else if (b.action === "preset") await ctx.app.onvif.gotoPreset(t, str(b.preset, "preset", { required: true, max: 64 }));
    else throw new HttpError(400, "action must be move, stop or preset");
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, errMsg(e));
  }
  return ok();
});

r.get("/api/cameras/:id/ptz/presets", "user", async (ctx) => {
  const cam = camOf(ctx);
  const t = ctx.app.onvifTarget(cam);
  if (!t) return json({ presets: [] });
  try {
    return json({ presets: await ctx.app.onvif.presets(t) });
  } catch (e) {
    throw new HttpError(502, errMsg(e));
  }
});

r.get("/player/video-rtc.js", "public", () => new Response(VIDEO_RTC_JS, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=86400" } }));

r.get("/player/:id", "user", (ctx) => {
  camOf(ctx);
  return new Response(playerHtml(ctx.params.id!), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: data:; connect-src 'self' ws: wss:",
    },
  });
});

// discovery & integrations

r.get("/api/discover", "admin", async (ctx) => json({ candidates: await discover({ knownHosts: knownHosts(ctx) }) }));

r.post("/api/integrations/unifi/import", "admin", async (ctx) => {
  const b = await readJson<{ host?: string; username?: string; password?: string; cameraIds?: string[] }>(ctx.req);
  const host = str(b.host, "host", { required: true, max: 200 });
  const list = await importUnifi(host, str(b.username, "username", { required: true }), str(b.password, "password", { required: true }), Array.isArray(b.cameraIds) ? b.cameraIds : undefined);
  const existing = new Set(ctx.app.cameras.list().filter((c) => c.brand === "unifi").map((c) => c.fields.alias));
  const out: { id: string; name: string; model: string; added: boolean; cameraId?: string; error?: string }[] = [];
  const consoleHost = hostOnly(host);
  for (const u of list) {
    if (!u.alias) {
      out.push({ id: u.id, name: u.name, model: u.model, added: false, error: "RTSP could not be enabled" });
      continue;
    }
    if (existing.has(u.alias)) {
      out.push({ id: u.id, name: u.name, model: u.model, added: false, error: "already added" });
      continue;
    }
    const fields = { host: consoleHost, alias: u.alias, subAlias: u.subAlias ?? "" };
    const cam = ctx.app.cameras.create({
      name: u.name,
      brand: "unifi",
      built: buildSource("unifi", "unifi", fields),
      fields,
      defaultSensitivity: ctx.app.settings.get().motion.defaultSensitivity,
    });
    out.push({ id: u.id, name: u.name, model: u.model, added: true, cameraId: cam.id });
  }
  return json({ cameras: out });
});

// recordings, timeline, events

r.get("/api/recordings", "user", (ctx) => {
  const q = ctx.url.searchParams;
  return json(
    ctx.app.recordings.list({
      camera: q.get("camera") || undefined,
      from: parseTime(q.get("from")),
      to: parseTime(q.get("to")),
      limit: limitOf(ctx.url),
      cursor: q.get("cursor") || undefined,
    }),
  );
});

r.get("/api/recordings/:id", "user", (ctx) => {
  const j = ctx.app.recordings.json(ctx.params.id!);
  if (!j) throw new HttpError(404, "Recording not found");
  return json(j);
});

r.get("/api/recordings/:id/video.mp4", "user", (ctx) => {
  const rec = ctx.app.recordings.require(ctx.params.id!);
  if (rec.path) {
    const p = safeJoin(ctx.app.dirs.recordings, rec.path);
    if (p && ctx.app.storage.localFileSize(rec.path) !== undefined) return serveFile(p, ctx.req, "video/mp4");
  }
  const range = parseRange(ctx.req.headers.get("range"), rec.size);
  if (range === "invalid") return new Response(null, { status: 416, headers: { "content-range": `bytes */${rec.size}` } });
  return ctx.app.storage.streamRemote(rec.id, rec.size, range);
});

r.get("/api/recordings/:id/thumb.jpg", "user", (ctx) => {
  const rec = ctx.app.recordings.require(ctx.params.id!);
  const p = rec.thumb_path ? safeJoin(ctx.app.dirs.thumbs, rec.thumb_path) : undefined;
  if (!p) throw new HttpError(404, "No thumbnail");
  return serveFile(p, ctx.req, "image/jpeg", "private, max-age=86400");
});

r.delete("/api/recordings/:id", "admin", async (ctx) => {
  await ctx.app.deleteRecording(ctx.params.id!);
  return ok();
});

r.get("/api/timeline", "user", (ctx) => {
  const q = ctx.url.searchParams;
  const camera = str(q.get("camera"), "camera", { required: true });
  ctx.app.cameras.require(camera);
  const tz = q.get("tz") || "UTC";
  const day = q.get("day") || new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  const { from, to } = dayBounds(day, tz);
  return json({
    day,
    tz,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    ranges: ctx.app.recordings.ranges(camera, from, to),
    events: ctx.app.recordings.events({ camera, from, to, limit: 2000 }).items,
    days: ctx.app.recordings.daysWithFootage(camera, tz),
  });
});

r.get("/api/events", "user", (ctx) => {
  const q = ctx.url.searchParams;
  return json(
    ctx.app.recordings.events({
      camera: q.get("camera") || undefined,
      from: parseTime(q.get("from")),
      before: parseTime(q.get("before")),
      limit: limitOf(ctx.url),
      cursor: q.get("cursor") || undefined,
    }),
  );
});

r.get("/api/events/:id/snapshot.jpg", "user", (ctx) => {
  const ev = ctx.app.recordings.getEvent(ctx.params.id!);
  if (!ev) throw new HttpError(404, "Event not found");
  const p = ev.snapshot_path ? safeJoin(ctx.app.dirs.events, ev.snapshot_path) : undefined;
  if (!p) throw new HttpError(404, "No snapshot for this event");
  return serveFile(p, ctx.req, "image/jpeg", "private, max-age=86400");
});

r.post("/api/clips", "user", async (ctx) => {
  const b = await readJson<{ cameraId?: string; start?: string; end?: string }>(ctx.req);
  const camera = ctx.app.cameras.require(str(b.cameraId, "cameraId", { required: true }));
  const start = parseTime(b.start);
  const end = parseTime(b.end);
  if (start === undefined || end === undefined) throw new HttpError(400, "start and end are required");
  const id = await ctx.app.exportClip(camera.id, start, end);
  return json({ url: `/api/clips/${id}.mp4`, expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString() });
});

r.get("/api/clips/:file", "user", (ctx) => {
  const m = ctx.params.file!.match(/^([a-z0-9]{16})\.mp4$/);
  if (!m) throw new HttpError(404, "Not found");
  return serveFile(join(ctx.app.dirs.clips, `${m[1]}.mp4`), ctx.req, "video/mp4");
});

// storage

r.get("/api/storage", "admin", (ctx) => {
  const { app } = ctx;
  const s = app.settings.get();
  const disk = app.disk();
  return json({
    local: { path: app.dirs.recordings, usedBytes: disk.usedBytes, freeBytes: disk.freeBytes, totalBytes: disk.totalBytes, retentionDays: s.retention.localDays, maxGB: s.retention.maxLocalGB },
    targets: app.storage.list().map((t) => app.storage.json(t)),
    types: app.storage.types(),
    gdrive: app.gdrive.capabilities(),
    rclone: app.storage.rclone.available,
  });
});

r.post("/api/storage/targets", "admin", async (ctx) => {
  const t = await ctx.app.storage.create(await readJson(ctx.req));
  return json(ctx.app.storage.json(t), { status: 201 });
});

r.post("/api/storage/targets/test", "admin", async (ctx) => json(await ctx.app.storage.test(await readJson(ctx.req))));

r.patch("/api/storage/targets/:id", "admin", async (ctx) => {
  const t = await ctx.app.storage.update(ctx.params.id!, await readJson(ctx.req));
  return json(ctx.app.storage.json(t));
});

r.delete("/api/storage/targets/:id", "admin", (ctx) => {
  ctx.app.storage.delete(ctx.params.id!);
  return ok();
});

r.post("/api/storage/targets/:id/retention", "admin", async (ctx) => {
  ctx.app.storage.require(ctx.params.id!);
  await ctx.app.storage.remoteRetention();
  ctx.app.retention();
  return ok();
});

r.post("/api/storage/gdrive/start", "admin", async (ctx) => json(await ctx.app.gdrive.start(await readJson(ctx.req), ctx.base)));

r.get("/api/storage/gdrive/callback", "public", async (ctx) => {
  const q = ctx.url.searchParams;
  const res = await ctx.app.gdrive.callback(q.get("state") ?? "", q.get("code"), q.get("error"));
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenCCTV</title><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#0B0D10;color:#E6E8EB;font:15px -apple-system,system-ui,sans-serif"><div style="max-width:420px;padding:32px;text-align:center"><div style="width:44px;height:44px;margin:0 auto 18px;border-radius:50%;background:${res.ok ? "#14B8A6" : "#F43F5E"}"></div><p>${res.message.replace(/[<>&]/g, "")}</p></div><script>setTimeout(()=>window.close(),2500)</script></body>`;
  return new Response(html, { status: res.ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } });
});

r.get("/api/storage/gdrive/:flowId", "admin", (ctx) => {
  const f = ctx.app.gdrive.status(ctx.params.flowId!);
  if (!f) throw new HttpError(404, "Unknown flow");
  const target = f.targetId ? ctx.app.storage.get(f.targetId) : undefined;
  return json({ status: f.status, target: target ? ctx.app.storage.json(target) : undefined, error: f.error });
});

// settings, system, push

r.get("/api/settings", "user", (ctx) => json(ctx.app.settingsJson()));
r.patch("/api/settings", "admin", async (ctx) => {
  const b = await readJson(ctx.req);
  if (!isPlainObject(b)) throw new HttpError(400, "Body must be an object");
  ctx.app.settings.patch(b);
  return json(ctx.app.settingsJson());
});

r.get("/api/system", "user", (ctx) => {
  const { app } = ctx;
  const stats = app.recordings.stats();
  const mem = process.memoryUsage();
  return json({
    version: VERSION,
    uptimeSec: Math.round((Date.now() - app.startedAt) / 1000),
    platform: `${platform()}-${arch()}`,
    cpuPercent: app.cpuPercent(),
    memBytes: mem.rss,
    disk: app.disk(),
    components: {
      go2rtc: { version: app.go2rtc.version ?? app.versions.go2rtc, ok: app.go2rtc.running, path: app.bins.go2rtc ? "installed" : "missing" },
      ffmpeg: { version: app.versions.ffmpeg, ok: !!app.bins.ffmpeg },
      rclone: { version: app.versions.rclone, ok: !!app.bins.rclone },
    },
    cameras: app.cameras.count(),
    recordingsCount: stats.count,
    recordingsBytes: stats.bytes,
    pushDevices: app.push.count(),
    demo: app.cfg.demo,
  });
});

r.get("/api/system/logs", "admin", (ctx) => json({ lines: recentLogs(Number(ctx.url.searchParams.get("lines") || 200)) }));

r.post("/api/push/register", "user", async (ctx) => {
  const b = await readJson<{ expoPushToken?: string; platform?: string; cameras?: string[] }>(ctx.req);
  ctx.app.push.register(ctx.user!.id, b.expoPushToken, b.platform, b.cameras, ctx.base);
  return ok();
});

r.delete("/api/push/register", "user", async (ctx) => {
  const b = await readJson<{ expoPushToken?: string }>(ctx.req);
  ctx.app.push.unregister(b.expoPushToken);
  return ok();
});

r.get("/api/ws", "user", (ctx) => {
  if (ctx.server?.upgrade(ctx.req, { data: { kind: "events", role: ctx.user!.role } })) return undefined;
  throw new HttpError(400, "WebSocket upgrade required");
});

// gateway

r.get("/api/sites", "user", (ctx) => json({ items: ctx.app.hub.list() }));
r.post("/api/sites", "admin", async (ctx) => {
  const b = await readJson<{ name?: string }>(ctx.req);
  return json(ctx.app.hub.create(str(b.name, "name", { max: 80 }) || "Home"), { status: 201 });
});
r.post("/api/sites/:id/link-code", "admin", (ctx) => json(ctx.app.hub.regenerateLinkCode(ctx.params.id!)));
r.delete("/api/sites/:id", "admin", (ctx) => {
  ctx.app.hub.delete(ctx.params.id!);
  return ok();
});

r.post("/api/gateway/claim", "public", async (ctx) => {
  if (!ctx.app.auth.limiter.check(`claim:${ctx.ip}`)) throw new HttpError(429, "Too many attempts");
  const b = await readJson<{ linkCode?: string; name?: string; version?: string }>(ctx.req);
  return json(ctx.app.hub.claim(str(b.linkCode, "linkCode", { required: true, max: 40 }), typeof b.name === "string" ? b.name.slice(0, 80) : undefined, typeof b.version === "string" ? b.version.slice(0, 40) : undefined));
});

r.post("/api/gateway/link", "admin", async (ctx) => {
  if (ctx.meta.tunnel) throw new HttpError(400, "Change the gateway link on the server itself");
  const b = await readJson<{ url?: string; linkCode?: string }>(ctx.req);
  const res = await ctx.app.linkGateway(str(b.url, "url", { required: true, max: 300 }), str(b.linkCode, "linkCode", { required: true, max: 40 }));
  return json({ ok: true, siteId: res.siteId });
});

r.delete("/api/gateway/link", "admin", (ctx) => {
  if (ctx.meta.tunnel) throw new HttpError(400, "Change the gateway link on the server itself");
  ctx.app.unlinkGateway();
  return ok();
});

export const router = r;
