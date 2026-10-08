import type { Server, ServerWebSocket } from "bun";
import type { App, HandleMeta } from "../app.ts";
import type { AuthUser, Role } from "../auth.ts";
import { bearerToken } from "../auth.ts";
import { router } from "./api.ts";
import { VERSION } from "../config.ts";
import { roleAllows, type Ctx } from "./router.ts";
import { HttpError, errorResponse, safeEqual } from "../util.ts";
import { logger, errMsg } from "../log.ts";
import type { ClientWsData, TunnelSocketData } from "../gateway/hub.ts";
import type { ReqHead, WsOpen } from "../gateway/frames.ts";
import index from "../../web/index.html";

const log = logger("http");

type EventsData = { kind: "events"; role: Role; off?: () => void };
type StreamData = { kind: "stream"; target: string; upstream?: WebSocket; pending: (string | Uint8Array)[] };
type WsData = EventsData | StreamData | TunnelSocketData | ClientWsData;

const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;

function clientIp(req: Request, server?: Server<unknown>): string {
  const direct = server?.requestIP(req)?.address ?? "unknown";
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd && (LOOPBACK.test(direct) || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fc|fd)/.test(direct))) return fwd.split(",")[0]!.trim();
  return direct;
}

export function baseUrl(app: App, req: Request, meta: HandleMeta): string {
  if (meta.tunnel?.base) return meta.tunnel.base;
  if (app.cfg.publicUrl) return app.cfg.publicUrl;
  const url = new URL(req.url);
  const proto = (req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "")).toLowerCase();
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host") || url.host;
  const prefix = (req.headers.get("x-forwarded-prefix") ?? "").replace(/\/+$/, "");
  return `${proto === "https" ? "https" : "http"}://${host}${prefix}`;
}

function resolveUser(app: App, req: Request, url: URL, meta: HandleMeta, server?: Server<unknown>): { user?: AuthUser; token?: string } {
  if (meta.tunnel) {
    const role: Role = meta.tunnel.role === "admin" ? "admin" : "viewer";
    return { user: { id: "gateway", username: meta.tunnel.user ?? "gateway", role, createdAt: new Date(0).toISOString(), via: "tunnel" }, token: url.searchParams.get("token") ?? undefined };
  }
  const internal = req.headers.get("x-opencctv-internal");
  if (internal && server) {
    const ip = server.requestIP(req)?.address ?? "";
    if (LOOPBACK.test(ip) && safeEqual(internal, app.internalSecret)) {
      const role: Role = req.headers.get("x-opencctv-role") === "admin" ? "admin" : "viewer";
      return { user: { id: "gateway", username: req.headers.get("x-opencctv-user") ?? "gateway", role, createdAt: new Date(0).toISOString(), via: "internal" } };
    }
  }
  const token = bearerToken(req, url);
  const user = app.auth.userForToken(token);
  return user ? { user: { ...user, via: "token" }, token } : { token: undefined };
}

function securityHeaders(res: Response): Response {
  if (!res.headers.has("x-content-type-options")) {
    try {
      res.headers.set("x-content-type-options", "nosniff");
      res.headers.set("referrer-policy", "no-referrer");
    } catch {}
  }
  return res;
}

export function createHandler(app: App) {
  return async function handle(req: Request, meta: HandleMeta, server?: Server<unknown>): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }), req);
      if (!app.ready && !/^\/api\/(info|auth\/)/.test(url.pathname)) return errorResponse(503, "Server is starting");
      const m = router.match(req.method, url.pathname);
      if (!m.route) {
        if (m.methodMismatch) return errorResponse(405, "Method not allowed");
        return errorResponse(404, "Not found");
      }
      const { user, token } = resolveUser(app, req, url, meta, server);
      if (!roleAllows(user?.role, m.route.access)) return errorResponse(user ? 403 : 401, user ? "Admin role required" : "Authentication required");
      const ctx: Ctx = { req, url, params: m.params, user, app, base: baseUrl(app, req, meta), meta, server, ip: meta.tunnel ? "tunnel" : clientIp(req, server), token };
      const res = await m.route.handler(ctx);
      if (!res) return undefined as unknown as Response;
      return cors(securityHeaders(res), req);
    } catch (e) {
      if (e instanceof HttpError) return cors(errorResponse(e.status, e.message), req);
      if ((e as Error)?.name === "AbortError" || (e as Error)?.name === "TimeoutError") return errorResponse(504, "Upstream timeout");
      log.error(`${req.method} ${url.pathname}: ${errMsg(e)}`);
      return cors(errorResponse(500, "Internal server error"), req);
    }
  };
}

function cors(res: Response, req: Request): Response {
  const origin = req.headers.get("origin");
  if (!origin) return res;
  try {
    res.headers.set("access-control-allow-origin", origin);
    res.headers.set("vary", "origin");
    res.headers.set("access-control-allow-headers", "authorization, content-type, range");
    res.headers.set("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.headers.set("access-control-expose-headers", "content-range, content-length, accept-ranges");
  } catch {}
  return res;
}

const GATEWAY_LOCAL = new Set(["api/auth/login", "api/auth/pair", "api/auth/me", "api/auth/logout"]);
const GATEWAY_PUBLIC = new Set(["api/info", "player/video-rtc.js", "api/storage/gdrive/callback"]);

async function handleSite(app: App, req: Request, server: Server<unknown>, handle: ReturnType<typeof createHandler>): Promise<Response | undefined> {
  const url = new URL(req.url);
  const m = url.pathname.match(/^\/s\/([a-z0-9]{1,40})(\/.*)?$/);
  if (!m) return errorResponse(404, "Not found");
  const siteId = m[1]!;
  const rest = (m[2] ?? "/").replace(/^\/+/, "");
  if (!app.hub.exists(siteId)) return errorResponse(404, "Unknown site");
  if (GATEWAY_LOCAL.has(rest)) {
    const local = new Request(new URL(`/${rest}${url.search}`, url), req);
    return handle(local, {}, server);
  }
  if (!rest.startsWith("api/") && !rest.startsWith("player/")) return errorResponse(404, "Not found");
  if (rest === "api/auth/setup") return errorResponse(403, "Setup must be done on the server itself");
  let user: AuthUser | undefined;
  if (!GATEWAY_PUBLIC.has(rest)) {
    const token = bearerToken(req, url);
    const u = app.auth.userForToken(token);
    if (!u) return errorResponse(401, "Authentication required");
    user = u;
  }
  const base = `${baseUrl(app, req, {})}/s/${siteId}`;
  const headers: [string, string][] = [];
  req.headers.forEach((v, k) => {
    if (["authorization", "cookie", "host", "connection", "upgrade", "x-opencctv-internal", "x-opencctv-role", "x-opencctv-user"].includes(k) || k.startsWith("sec-websocket")) return;
    headers.push([k, v]);
  });
  const path = `/${rest}${url.search}`;
  if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    const protocols = req.headers.get("sec-websocket-protocol")?.split(",").map((s) => s.trim()).filter(Boolean);
    const open: WsOpen = { path, headers, protocols, role: user?.role, user: user?.username, base };
    if (server.upgrade(req, { data: { kind: "site-ws", siteId, open, pending: [], accepted: false } satisfies ClientWsData })) return undefined;
    return errorResponse(400, "Upgrade failed");
  }
  const head: ReqHead = { method: req.method, path, headers, role: user?.role, user: user?.username, base };
  const res = await app.hub.forward(siteId, req, head);
  res.headers.delete("set-cookie");
  res.headers.set("x-content-type-options", "nosniff");
  if (!rest.startsWith("player/")) res.headers.set("content-security-policy", "sandbox; default-src 'none'");
  const length = Number(res.headers.get("content-length") ?? NaN);
  if (req.method !== "HEAD" && res.body && Number.isInteger(length) && length >= 0 && length <= BUFFER_LIMIT) {
    const data = await readExactly(res.body, length);
    if (!data) return errorResponse(502, "Incomplete response from site");
    return new Response(data, { status: res.status, headers: res.headers });
  }
  return res;
}

const BUFFER_LIMIT = 1024 * 1024;

async function readExactly(body: ReadableStream<Uint8Array>, length: number): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const out = new Uint8Array(length);
  let off = 0;
  const reader = body.getReader();
  try {
    while (off < length) {
      const { done, value } = await reader.read();
      if (done) break;
      const n = Math.min(value.length, length - off);
      out.set(value.subarray(0, n), off);
      off += n;
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  return off === length ? out : undefined;
}

export function startServer(app: App): Server<WsData> {
  const handle = createHandler(app);
  app.handler = (req, meta) => handle(req, meta, app.server);
  const api = async (req: Request, server: Server<WsData>) => {
    const res = await handle(req, {}, server as unknown as Server<unknown>);
    return res;
  };
  const server = Bun.serve<WsData>({
    port: app.cfg.port,
    hostname: app.cfg.host,
    idleTimeout: 120,
    maxRequestBodySize: 64 * 1024 * 1024,
    development: false,
    routes: {
      "/api/gateway/tunnel": (req: Request, server: Server<WsData>) => {
        const siteId = req.headers.get("x-opencctv-site");
        const secret = bearerToken(req, new URL(req.url));
        if (!app.hub.authenticateSite(siteId, secret)) return errorResponse(401, "Invalid site credentials");
        if (server.upgrade(req, { data: { kind: "tunnel", siteId: siteId! } })) return undefined as unknown as Response;
        return errorResponse(400, "WebSocket upgrade required");
      },
      "/api/*": api,
      "/player/*": api,
      "/s/*": async (req: Request, server: Server<WsData>) => {
        try {
          return (await handleSite(app, req, server as unknown as Server<unknown>, handle)) as Response;
        } catch (e) {
          if (e instanceof HttpError) return errorResponse(e.status, e.message);
          log.error(`gateway proxy: ${errMsg(e)}`);
          return errorResponse(502, "Gateway error");
        }
      },
      "/healthz": () => new Response("ok"),
      "/*": index,
    },
    fetch: () => errorResponse(404, "Not found"),
    websocket: {
      maxPayloadLength: 16 * 1024 * 1024,
      idleTimeout: 120,
      sendPings: true,
      open(ws) {
        const d = ws.data;
        if (d.kind === "events") {
          d.off = app.bus.on((msg) => {
            if (msg.type === "site" && d.role !== "admin") return;
            ws.send(JSON.stringify(msg));
          });
          ws.send(JSON.stringify({ type: "hello", version: VERSION, name: app.settings.get().serverName }));
        } else if (d.kind === "stream") openStream(ws as ServerWebSocket<StreamData>);
        else if (d.kind === "tunnel") app.hub.onOpen(ws as ServerWebSocket<TunnelSocketData>);
        else if (d.kind === "site-ws") app.hub.clientWsOpen(ws as ServerWebSocket<ClientWsData>);
      },
      message(ws, msg) {
        const d = ws.data;
        if (d.kind === "stream") {
          const m = typeof msg === "string" ? msg : new Uint8Array(msg);
          if (d.upstream?.readyState === WebSocket.OPEN) d.upstream.send(m);
          else d.pending.push(m);
        } else if (d.kind === "tunnel") app.hub.onMessage(ws as ServerWebSocket<TunnelSocketData>, msg);
        else if (d.kind === "site-ws") app.hub.clientWsMessage(ws as ServerWebSocket<ClientWsData>, msg);
      },
      close(ws, code, reason) {
        const d = ws.data;
        if (d.kind === "events") d.off?.();
        else if (d.kind === "stream") {
          try {
            d.upstream?.close();
          } catch {}
        } else if (d.kind === "tunnel") app.hub.onClose(ws as ServerWebSocket<TunnelSocketData>);
        else if (d.kind === "site-ws") app.hub.clientWsClose(ws as ServerWebSocket<ClientWsData>, code, reason);
      },
    },
  });
  app.server = server as unknown as Server<unknown>;
  return server;
}

function openStream(ws: ServerWebSocket<StreamData>) {
  const d = ws.data;
  const up = new WebSocket(d.target);
  up.binaryType = "arraybuffer";
  d.upstream = up;
  up.onopen = () => {
    for (const m of d.pending) up.send(m);
    d.pending = [];
  };
  up.onmessage = (ev) => {
    if (typeof ev.data === "string") ws.send(ev.data);
    else ws.send(new Uint8Array(ev.data as ArrayBuffer));
  };
  up.onclose = () => {
    try {
      ws.close();
    } catch {}
  };
  up.onerror = () => {
    try {
      ws.close(1011, "stream error");
    } catch {}
  };
}
