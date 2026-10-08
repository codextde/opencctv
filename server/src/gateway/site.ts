import { logger, errMsg } from "../log.ts";
import {
  CreditGate,
  F,
  MAX_CHUNK,
  chunks,
  decodeCredit,
  decodeFrame,
  encodeFrame,
  frameJson,
  frameText,
  type Frame,
  type ReqHead,
  type WsOpen,
} from "./frames.ts";

const log = logger("tunnel");

export type TunnelHandler = (req: Request, meta: { role: string; user?: string; base?: string }) => Promise<Response>;

type InReq = { head: ReqHead; body: Uint8Array[]; size: number; abort: AbortController; gate?: CreditGate };

export type TunnelOptions = {
  url: string;
  siteId: string;
  secret: string;
  hello: () => { version: string; cameras: number; name: string };
  handle: TunnelHandler;
  localWsBase: () => string;
  internalSecret: string;
};

export function tunnelUrl(gatewayUrl: string): string {
  const u = new URL(gatewayUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = u.pathname.replace(/\/+$/, "") + "/api/gateway/tunnel";
  u.search = "";
  return u.toString();
}

export class TunnelClient {
  private ws?: WebSocket;
  private stopped = false;
  private backoff = 1000;
  private timer?: ReturnType<typeof setTimeout>;
  private helloTimer?: ReturnType<typeof setInterval>;
  private reqs = new Map<number, InReq>();
  private wss = new Map<number, WebSocket>();
  connected = false;
  lastError?: string;
  private lastActivity = Date.now();

  constructor(private o: TunnelOptions) {}

  start() {
    this.stopped = false;
    this.connect();
    this.helloTimer = setInterval(() => {
      if (!this.connected) return;
      this.send(encodeFrame(F.HELLO, 0, this.o.hello()));
      if (Date.now() - this.lastActivity > 120_000) {
        log.warn("no traffic from gateway, reconnecting");
        this.ws?.close();
      }
    }, 30_000);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.helloTimer);
    this.ws?.close(1000, "stopped");
    this.cleanup();
  }

  private connect() {
    if (this.stopped) return;
    const url = tunnelUrl(this.o.url);
    let ws: WebSocket;
    try {
      ws = new WebSocket(url, { headers: { authorization: `Bearer ${this.o.secret}`, "x-opencctv-site": this.o.siteId } } as unknown as string[]);
    } catch (e) {
      this.lastError = errMsg(e);
      this.reconnect();
      return;
    }
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.lastError = undefined;
      this.backoff = 1000;
      this.lastActivity = Date.now();
      log.info(`connected to gateway ${this.o.url}`);
      this.send(encodeFrame(F.HELLO, 0, this.o.hello()));
    };
    ws.onmessage = (ev) => {
      this.lastActivity = Date.now();
      if (typeof ev.data === "string") return;
      try {
        this.onFrame(decodeFrame(ev.data as ArrayBuffer));
      } catch (e) {
        log.warn(`bad frame: ${errMsg(e)}`);
      }
    };
    ws.onerror = () => {
      this.lastError = "connection error";
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      const was = this.connected;
      this.connected = false;
      this.cleanup();
      if (ev.code === 4001) {
        this.lastError = "site was deleted on the gateway";
        log.warn(this.lastError);
        return;
      }
      if (was) log.warn(`gateway connection closed (${ev.code}${ev.reason ? " " + ev.reason : ""})`);
      if (!this.lastError) this.lastError = ev.reason || `closed (${ev.code})`;
      this.reconnect();
    };
  }

  private reconnect() {
    if (this.stopped) return;
    clearTimeout(this.timer);
    const delay = this.backoff + Math.floor(Math.random() * 500);
    this.backoff = Math.min(this.backoff * 2, 30_000);
    this.timer = setTimeout(() => this.connect(), delay);
  }

  private cleanup() {
    for (const r of this.reqs.values()) {
      r.abort.abort();
      r.gate?.close();
    }
    this.reqs.clear();
    for (const w of this.wss.values()) {
      try {
        w.close();
      } catch {}
    }
    this.wss.clear();
  }

  private send(frame: Uint8Array) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(frame);
  }

  private get buffered(): number {
    return this.ws?.bufferedAmount ?? 0;
  }

  private onFrame(f: Frame) {
    switch (f.type) {
      case F.PING:
        this.send(encodeFrame(F.PONG, 0));
        break;
      case F.REQ:
        this.reqs.set(f.stream, { head: frameJson<ReqHead>(f), body: [], size: 0, abort: new AbortController() });
        break;
      case F.REQ_DATA: {
        const r = this.reqs.get(f.stream);
        if (!r) return;
        r.size += f.payload.length;
        if (r.size > 32 * 1024 * 1024) {
          this.reqs.delete(f.stream);
          this.send(encodeFrame(F.ERROR, f.stream, { message: "request too large" }));
          return;
        }
        r.body.push(f.payload.slice());
        break;
      }
      case F.REQ_END: {
        const r = this.reqs.get(f.stream);
        if (r) void this.dispatch(f.stream, r);
        break;
      }
      case F.CREDIT:
        this.reqs.get(f.stream)?.gate?.add(decodeCredit(f));
        break;
      case F.CANCEL: {
        const r = this.reqs.get(f.stream);
        if (r) {
          this.reqs.delete(f.stream);
          r.abort.abort();
          r.gate?.close();
        }
        const w = this.wss.get(f.stream);
        if (w) {
          this.wss.delete(f.stream);
          w.close();
        }
        break;
      }
      case F.WS_OPEN:
        this.openWs(f.stream, frameJson<WsOpen>(f));
        break;
      case F.WS_TEXT:
        this.wsSend(f.stream, frameText(f));
        break;
      case F.WS_BINARY:
        this.wsSend(f.stream, f.payload.slice());
        break;
      case F.WS_CLOSE: {
        const w = this.wss.get(f.stream);
        this.wss.delete(f.stream);
        try {
          w?.close();
        } catch {}
        break;
      }
    }
  }

  private async dispatch(stream: number, r: InReq) {
    const { head } = r;
    const total = r.body.reduce((s, b) => s + b.length, 0);
    let body: Uint8Array | undefined;
    if (total > 0) {
      body = new Uint8Array(total);
      let off = 0;
      for (const b of r.body) {
        body.set(b, off);
        off += b.length;
      }
    }
    r.body = [];
    let res: Response;
    try {
      const req = new Request(`http://tunnel${head.path}`, {
        method: head.method,
        headers: head.headers,
        body: body && !["GET", "HEAD"].includes(head.method) ? (body as unknown as BodyInit) : undefined,
        signal: r.abort.signal,
      });
      res = await this.o.handle(req, { role: head.role ?? "viewer", user: head.user, base: head.base });
    } catch (e) {
      if (this.reqs.has(stream)) this.send(encodeFrame(F.ERROR, stream, { message: errMsg(e) }));
      this.reqs.delete(stream);
      return;
    }
    if (!this.reqs.has(stream)) {
      await res.body?.cancel().catch(() => {});
      return;
    }
    const headers: [string, string][] = [];
    res.headers.forEach((v, k) => {
      if (k !== "content-encoding" && k !== "transfer-encoding" && k !== "connection") headers.push([k, v]);
    });
    this.send(encodeFrame(F.RES, stream, { status: res.status, headers }));
    const gate = new CreditGate();
    r.gate = gate;
    if (res.body && head.method !== "HEAD") {
      const reader = res.body.getReader();
      r.abort.signal.addEventListener("abort", () => void reader.cancel().catch(() => {}));
      const declared = res.headers.get("content-length");
      let left = declared !== null && /^\d+$/.test(declared) ? Number(declared) : Infinity;
      try {
        while (left > 0) {
          const { done, value: v } = await reader.read();
          if (done) break;
          if (!v?.length) continue;
          const value = v.length > left ? v.subarray(0, left) : v;
          left -= value.length;
          for (const ch of chunks(value, MAX_CHUNK)) {
            if (!(await gate.take(ch.length))) throw new Error("cancelled");
            while (this.buffered > 4 * 1024 * 1024 && this.connected) await Bun.sleep(10);
            this.send(encodeFrame(F.RES_DATA, stream, ch));
          }
        }
        if (left === 0) void reader.cancel().catch(() => {});
      } catch {
        void reader.cancel().catch(() => {});
        if (this.reqs.delete(stream)) this.send(encodeFrame(F.CANCEL, stream));
        return;
      }
    } else await res.body?.cancel().catch(() => {});
    if (this.reqs.delete(stream)) this.send(encodeFrame(F.RES_END, stream));
  }

  private openWs(stream: number, o: WsOpen) {
    if (!o.path.startsWith("/api/")) {
      this.send(encodeFrame(F.WS_CLOSE, stream, { code: 1008, reason: "not allowed" }));
      return;
    }
    const headers: Record<string, string> = {
      "x-opencctv-internal": this.o.internalSecret,
      "x-opencctv-role": o.role ?? "viewer",
    };
    if (o.user) headers["x-opencctv-user"] = o.user;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.o.localWsBase() + o.path, { headers, protocols: o.protocols } as unknown as string[]);
    } catch (e) {
      this.send(encodeFrame(F.WS_CLOSE, stream, { code: 1011, reason: errMsg(e) }));
      return;
    }
    ws.binaryType = "arraybuffer";
    this.wss.set(stream, ws);
    ws.onopen = () => this.send(encodeFrame(F.WS_ACCEPT, stream, { protocol: ws.protocol }));
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") this.send(encodeFrame(F.WS_TEXT, stream, ev.data));
      else this.send(encodeFrame(F.WS_BINARY, stream, new Uint8Array(ev.data as ArrayBuffer)));
    };
    ws.onclose = (ev) => {
      if (this.wss.delete(stream)) this.send(encodeFrame(F.WS_CLOSE, stream, { code: ev.code, reason: ev.reason }));
    };
  }

  private wsSend(stream: number, data: string | Uint8Array) {
    const w = this.wss.get(stream);
    if (!w) return;
    if (w.readyState === WebSocket.OPEN) w.send(data);
    else if (w.readyState === WebSocket.CONNECTING) w.addEventListener("open", () => w.send(data), { once: true });
  }
}
