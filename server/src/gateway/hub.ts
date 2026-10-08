import type { ServerWebSocket } from "bun";
import type { DB } from "../db.ts";
import type { Bus } from "../bus.ts";
import { HttpError, newId, randomCode, randomToken, safeEqual, sha256, toIso } from "../util.ts";
import { logger } from "../log.ts";
import {
  CreditGate,
  F,
  MAX_CHUNK,
  chunks,
  creditedStream,
  decodeCredit,
  decodeFrame,
  encodeCredit,
  encodeFrame,
  frameJson,
  frameText,
  type Frame,
  type ResHead,
  type ReqHead,
  type WsOpen,
} from "./frames.ts";

const log = logger("gateway");

type SiteRow = {
  id: string;
  name: string;
  secret_hash: string | null;
  link_code_hash: string | null;
  link_expires: number | null;
  last_seen: number | null;
  version: string | null;
  cameras: number;
  created_at: number;
};

export type TunnelSocketData = { kind: "tunnel"; siteId: string };
export type ClientWsData = { kind: "site-ws"; siteId: string; open: WsOpen; stream?: number; pending: (string | Uint8Array)[]; accepted: boolean };

type PendingReq = {
  resolve: (r: Response) => void;
  reject: (e: Error) => void;
  body?: ReturnType<typeof creditedStream>;
  timer?: ReturnType<typeof setTimeout>;
};

class SiteConn {
  private nextStream = 1;
  readonly reqs = new Map<number, PendingReq>();
  readonly wss = new Map<number, ServerWebSocket<ClientWsData>>();
  lastPong = Date.now();

  constructor(readonly siteId: string, readonly ws: ServerWebSocket<TunnelSocketData>) {}

  alloc(): number {
    const id = this.nextStream;
    this.nextStream = (this.nextStream + 2) % 0x7fffffff || 1;
    return id;
  }

  send(frame: Uint8Array): void {
    this.ws.send(frame);
  }

  get buffered(): number {
    return this.ws.getBufferedAmount();
  }

  closeAll(reason: string) {
    for (const [, p] of this.reqs) {
      clearTimeout(p.timer);
      p.resolve(new Response(JSON.stringify({ error: reason }), { status: 502, headers: { "content-type": "application/json" } }));
      p.body?.end();
    }
    this.reqs.clear();
    for (const [, c] of this.wss) {
      try {
        c.close(1012, "site disconnected");
      } catch {}
    }
    this.wss.clear();
  }
}

export class GatewayHub {
  private conns = new Map<string, SiteConn>();
  private pingTimer?: ReturnType<typeof setInterval>;

  constructor(private db: DB, private bus: Bus) {}

  start() {
    this.pingTimer = setInterval(() => {
      const now = Date.now();
      for (const c of this.conns.values()) {
        if (now - c.lastPong > 90_000) {
          log.warn(`site ${c.siteId} timed out`);
          try {
            c.ws.close(4000, "timeout");
          } catch {}
          continue;
        }
        c.send(encodeFrame(F.PING, 0));
      }
    }, 25_000);
  }

  stop() {
    clearInterval(this.pingTimer);
    for (const c of this.conns.values()) c.ws.close(1001, "shutdown");
  }

  // sites management

  list() {
    const rows = this.db.query("SELECT * FROM sites ORDER BY created_at").all() as SiteRow[];
    return rows.map((r) => this.siteJson(r));
  }

  private siteJson(r: SiteRow) {
    return {
      id: r.id,
      name: r.name,
      online: this.conns.has(r.id),
      lastSeen: r.last_seen ? toIso(this.conns.has(r.id) ? Date.now() : r.last_seen) : undefined,
      version: r.version ?? undefined,
      cameras: r.cameras,
      linked: !!r.secret_hash,
    };
  }

  create(name: string): { id: string; name: string; linkCode: string; expiresAt: string } {
    const id = newId(8);
    const code = this.newLinkCode();
    const expires = Date.now() + 24 * 3600_000;
    this.db
      .query("INSERT INTO sites(id, name, link_code_hash, link_expires, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, name.slice(0, 80) || "Home", sha256(code), expires, Date.now());
    return { id, name, linkCode: code, expiresAt: toIso(expires) };
  }

  regenerateLinkCode(id: string): { id: string; name: string; linkCode: string; expiresAt: string } {
    const row = this.db.query("SELECT * FROM sites WHERE id = ?").get(id) as SiteRow | null;
    if (!row) throw new HttpError(404, "Site not found");
    const code = this.newLinkCode();
    const expires = Date.now() + 24 * 3600_000;
    this.db.query("UPDATE sites SET link_code_hash = ?, link_expires = ? WHERE id = ?").run(sha256(code), expires, id);
    return { id, name: row.name, linkCode: code, expiresAt: toIso(expires) };
  }

  private newLinkCode(): string {
    const c = randomCode(12);
    return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
  }

  delete(id: string): void {
    const r = this.db.query("DELETE FROM sites WHERE id = ?").run(id);
    if (!r.changes) throw new HttpError(404, "Site not found");
    this.conns.get(id)?.ws.close(4001, "site deleted");
  }

  claim(linkCode: string, name?: string, version?: string): { siteId: string; secret: string; name: string } {
    const norm = linkCode.trim().toUpperCase();
    const row = this.db.query("SELECT * FROM sites WHERE link_code_hash = ?").get(sha256(norm)) as SiteRow | null;
    if (!row || !row.link_expires || row.link_expires < Date.now()) throw new HttpError(401, "Invalid or expired link code");
    const secret = randomToken(32);
    this.db
      .query("UPDATE sites SET secret_hash = ?, link_code_hash = NULL, link_expires = NULL, version = ?, name = COALESCE(NULLIF(name, ''), ?) WHERE id = ?")
      .run(sha256(secret), version ?? null, name ?? "Home", row.id);
    log.info(`site ${row.name} (${row.id}) linked`);
    return { siteId: row.id, secret, name: row.name };
  }

  authenticateSite(siteId: string | null, secret: string | undefined): boolean {
    if (!siteId || !secret) return false;
    const row = this.db.query("SELECT secret_hash FROM sites WHERE id = ?").get(siteId) as { secret_hash: string | null } | null;
    return !!row?.secret_hash && safeEqual(row.secret_hash, sha256(secret));
  }

  exists(siteId: string): boolean {
    return !!this.db.query("SELECT 1 FROM sites WHERE id = ?").get(siteId);
  }

  online(siteId: string): boolean {
    return this.conns.has(siteId);
  }

  // tunnel socket lifecycle

  onOpen(ws: ServerWebSocket<TunnelSocketData>) {
    const prev = this.conns.get(ws.data.siteId);
    if (prev) {
      prev.closeAll("replaced");
      try {
        prev.ws.close(4002, "replaced by new connection");
      } catch {}
    }
    this.conns.set(ws.data.siteId, new SiteConn(ws.data.siteId, ws));
    this.db.query("UPDATE sites SET last_seen = ? WHERE id = ?").run(Date.now(), ws.data.siteId);
    log.info(`site ${ws.data.siteId} connected`);
    this.emitSite(ws.data.siteId);
  }

  onClose(ws: ServerWebSocket<TunnelSocketData>) {
    const c = this.conns.get(ws.data.siteId);
    if (c?.ws !== ws) return;
    this.conns.delete(ws.data.siteId);
    c.closeAll("site disconnected");
    this.db.query("UPDATE sites SET last_seen = ? WHERE id = ?").run(Date.now(), ws.data.siteId);
    log.info(`site ${ws.data.siteId} disconnected`);
    this.emitSite(ws.data.siteId);
  }

  private emitSite(id: string) {
    const r = this.db.query("SELECT * FROM sites WHERE id = ?").get(id) as SiteRow | null;
    if (r) this.bus.emit({ type: "site", site: this.siteJson(r) });
  }

  onMessage(ws: ServerWebSocket<TunnelSocketData>, data: string | Buffer) {
    const c = this.conns.get(ws.data.siteId);
    if (!c || c.ws !== ws || typeof data === "string") return;
    let f: Frame;
    try {
      f = decodeFrame(data);
    } catch {
      return;
    }
    c.lastPong = Date.now();
    switch (f.type) {
      case F.HELLO: {
        const h = frameJson<{ version?: string; cameras?: number; name?: string }>(f);
        this.db.query("UPDATE sites SET version = ?, cameras = ?, last_seen = ? WHERE id = ?").run(h.version ?? null, h.cameras ?? 0, Date.now(), c.siteId);
        this.emitSite(c.siteId);
        break;
      }
      case F.PING:
        c.send(encodeFrame(F.PONG, 0));
        break;
      case F.PONG:
        break;
      case F.RES: {
        const p = c.reqs.get(f.stream);
        if (!p) return;
        clearTimeout(p.timer);
        const head = frameJson<ResHead>(f);
        const stream = f.stream;
        const body = creditedStream(
          (n) => c.send(encodeCredit(stream, n)),
          () => {
            c.reqs.delete(stream);
            c.send(encodeFrame(F.CANCEL, stream));
          },
        );
        p.body = body;
        const headers = new Headers(head.headers);
        const noBody = head.status === 204 || head.status === 304;
        if (noBody) {
          c.reqs.delete(stream);
          body.end();
        }
        p.resolve(new Response(noBody ? null : body.stream, { status: head.status, headers }));
        break;
      }
      case F.RES_DATA:
        c.reqs.get(f.stream)?.body?.push(f.payload);
        break;
      case F.RES_END: {
        const p = c.reqs.get(f.stream);
        c.reqs.delete(f.stream);
        p?.body?.end();
        break;
      }
      case F.ERROR:
      case F.CANCEL: {
        const p = c.reqs.get(f.stream);
        if (p) {
          c.reqs.delete(f.stream);
          clearTimeout(p.timer);
          const msg = f.type === F.ERROR ? frameJson<{ message: string }>(f).message : "cancelled";
          if (p.body) p.body.end();
          else p.resolve(new Response(JSON.stringify({ error: `Site error: ${msg}` }), { status: 502, headers: { "content-type": "application/json" } }));
        }
        const w = c.wss.get(f.stream);
        if (w) {
          c.wss.delete(f.stream);
          try {
            w.close(1011, "site error");
          } catch {}
        }
        break;
      }
      case F.WS_ACCEPT: {
        const w = c.wss.get(f.stream);
        if (!w) return;
        w.data.accepted = true;
        for (const m of w.data.pending) this.forwardClientMessage(c, f.stream, m);
        w.data.pending = [];
        break;
      }
      case F.WS_TEXT:
        c.wss.get(f.stream)?.send(frameText(f));
        break;
      case F.WS_BINARY:
        c.wss.get(f.stream)?.send(f.payload.slice());
        break;
      case F.WS_CLOSE: {
        const w = c.wss.get(f.stream);
        c.wss.delete(f.stream);
        if (w) {
          const { code, reason } = frameJson<{ code?: number; reason?: string }>(f);
          try {
            w.close(code && code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000, reason?.slice(0, 120));
          } catch {}
        }
        break;
      }
    }
  }

  // forwarding

  async forward(siteId: string, req: Request, head: ReqHead): Promise<Response> {
    const c = this.conns.get(siteId);
    if (!c) return new Response(JSON.stringify({ error: "Site is offline" }), { status: 503, headers: { "content-type": "application/json" } });
    const stream = c.alloc();
    const body = req.body && !["GET", "HEAD"].includes(req.method) ? new Uint8Array(await req.arrayBuffer()) : undefined;
    if (body && body.length > 32 * 1024 * 1024) throw new HttpError(413, "Request body too large");
    const resP = new Promise<Response>((resolve, reject) => {
      const p: PendingReq = { resolve, reject };
      p.timer = setTimeout(() => {
        c.reqs.delete(stream);
        c.send(encodeFrame(F.CANCEL, stream));
        resolve(new Response(JSON.stringify({ error: "Site did not respond" }), { status: 504, headers: { "content-type": "application/json" } }));
      }, 45_000);
      c.reqs.set(stream, p);
    });
    c.send(encodeFrame(F.REQ, stream, head));
    if (body) for (const ch of chunks(body, MAX_CHUNK)) c.send(encodeFrame(F.REQ_DATA, stream, ch));
    c.send(encodeFrame(F.REQ_END, stream));
    req.signal?.addEventListener("abort", () => {
      if (c.reqs.has(stream)) {
        const p = c.reqs.get(stream);
        c.reqs.delete(stream);
        p?.body?.end();
        c.send(encodeFrame(F.CANCEL, stream));
      }
    });
    return resP;
  }

  clientWsOpen(ws: ServerWebSocket<ClientWsData>) {
    const c = this.conns.get(ws.data.siteId);
    if (!c) {
      ws.close(1013, "site offline");
      return;
    }
    const stream = c.alloc();
    ws.data.stream = stream;
    c.wss.set(stream, ws);
    c.send(encodeFrame(F.WS_OPEN, stream, ws.data.open));
  }

  clientWsMessage(ws: ServerWebSocket<ClientWsData>, msg: string | Buffer) {
    const c = this.conns.get(ws.data.siteId);
    if (!c || ws.data.stream === undefined) return;
    const m = typeof msg === "string" ? msg : new Uint8Array(msg);
    if (!ws.data.accepted) {
      ws.data.pending.push(m);
      return;
    }
    this.forwardClientMessage(c, ws.data.stream, m);
  }

  private forwardClientMessage(c: SiteConn, stream: number, m: string | Uint8Array) {
    if (typeof m === "string") c.send(encodeFrame(F.WS_TEXT, stream, m));
    else c.send(encodeFrame(F.WS_BINARY, stream, m));
  }

  clientWsClose(ws: ServerWebSocket<ClientWsData>, code: number, reason: string) {
    const c = this.conns.get(ws.data.siteId);
    if (!c || ws.data.stream === undefined) return;
    if (c.wss.delete(ws.data.stream)) c.send(encodeFrame(F.WS_CLOSE, ws.data.stream, { code, reason }));
  }
}

export { CreditGate, decodeCredit };
