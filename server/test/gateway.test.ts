import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server, ServerWebSocket } from "bun";
import { CreditGate, F, WINDOW, chunks, creditedStream, decodeCredit, decodeFrame, encodeCredit, encodeFrame, frameJson } from "../src/gateway/frames.ts";
import { GatewayHub, type ClientWsData, type TunnelSocketData } from "../src/gateway/hub.ts";
import { TunnelClient, tunnelUrl } from "../src/gateway/site.ts";
import { openDb } from "../src/db.ts";
import { Bus } from "../src/bus.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("tunnel framing", () => {
  test("encode/decode round trip", () => {
    const f = decodeFrame(encodeFrame(F.REQ, 0xdeadbeef, { method: "GET", path: "/api/x" }));
    expect(f.type).toBe(F.REQ);
    expect(f.stream).toBe(0xdeadbeef);
    expect(frameJson<{ path: string }>(f).path).toBe("/api/x");
    const bin = decodeFrame(encodeFrame(F.RES_DATA, 7, new Uint8Array([1, 2, 3])));
    expect([...bin.payload]).toEqual([1, 2, 3]);
    expect(decodeCredit(decodeFrame(encodeCredit(3, 123456)))).toBe(123456);
    expect(() => decodeFrame(new Uint8Array([99, 0, 0, 0, 1]))).toThrow();
    expect(() => decodeFrame(new Uint8Array([1]))).toThrow();
  });
  test("chunking", () => {
    const parts = [...chunks(new Uint8Array(150_000), 64 * 1024)];
    expect(parts.map((p) => p.length)).toEqual([65536, 65536, 18928]);
  });
  test("credit gate blocks until credit arrives", async () => {
    const g = new CreditGate(10);
    expect(await g.take(10)).toBe(true);
    let done = false;
    const p = g.take(5).then((v) => (done = v));
    await Bun.sleep(5);
    expect(done).toBe(false);
    g.add(5);
    await p;
    expect(done).toBe(true);
    const q = g.take(100);
    g.close();
    expect(await q).toBe(false);
  });
  test("credited stream grants credit only as the consumer reads", async () => {
    const credits: number[] = [];
    let cancelled = false;
    const s = creditedStream((n) => credits.push(n), () => (cancelled = true));
    s.push(new Uint8Array(WINDOW));
    s.push(new Uint8Array(1000));
    expect(credits.reduce((a, b) => a + b, 0)).toBe(0);
    const reader = s.stream.getReader();
    await reader.read();
    await reader.read();
    await Bun.sleep(1);
    expect(credits.reduce((a, b) => a + b, 0)).toBe(WINDOW + 1000);
    await reader.cancel();
    expect(cancelled).toBe(true);
  });
  test("tunnel url", () => {
    expect(tunnelUrl("https://gw.example.com/")).toBe("wss://gw.example.com/api/gateway/tunnel");
    expect(tunnelUrl("http://10.0.0.1:8080")).toBe("ws://10.0.0.1:8080/api/gateway/tunnel");
  });
});

describe("tunnel end to end", () => {
  type D = TunnelSocketData | ClientWsData;
  let gw: Server<D>;
  let local: Server<undefined>;
  let hub: GatewayHub;
  let client: TunnelClient;
  let siteId = "";
  let cancelledStreams = 0;
  const big = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 251);
  const sliceFile = join(mkdtempSync(join(tmpdir(), "occ-gw-")), "big.bin");
  writeFileSync(sliceFile, big);

  beforeAll(async () => {
    const db = openDb(":memory:");
    hub = new GatewayHub(db, new Bus());
    local = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return undefined;
        return new Response("no");
      },
      websocket: { message(ws, m) { ws.send(typeof m === "string" ? `echo:${m}` : m); } },
    });
    gw = Bun.serve<D>({
      port: 0,
      async fetch(req, server) {
        const url = new URL(req.url);
        if (url.pathname === "/api/gateway/tunnel") {
          const id = req.headers.get("x-opencctv-site");
          const secret = req.headers.get("authorization")?.slice(7);
          if (!hub.authenticateSite(id, secret)) return new Response("denied", { status: 401 });
          return server.upgrade(req, { data: { kind: "tunnel", siteId: id! } }) ? undefined : new Response("x", { status: 400 });
        }
        const m = url.pathname.match(/^\/s\/([^/]+)(\/.*)$/);
        if (!m) return new Response("nf", { status: 404 });
        if (req.headers.get("upgrade") === "websocket") {
          return server.upgrade(req, { data: { kind: "site-ws", siteId: m[1]!, open: { path: m[2]! + url.search, headers: [] }, pending: [], accepted: false } }) ? undefined : new Response("x");
        }
        return hub.forward(m[1]!, req, { method: req.method, path: m[2]! + url.search, headers: [...req.headers.entries()], role: "admin" });
      },
      websocket: {
        open(ws) {
          if (ws.data.kind === "tunnel") hub.onOpen(ws as ServerWebSocket<TunnelSocketData>);
          else hub.clientWsOpen(ws as ServerWebSocket<ClientWsData>);
        },
        message(ws, m) {
          if (ws.data.kind === "tunnel") hub.onMessage(ws as ServerWebSocket<TunnelSocketData>, m);
          else hub.clientWsMessage(ws as ServerWebSocket<ClientWsData>, m);
        },
        close(ws, code, reason) {
          if (ws.data.kind === "tunnel") hub.onClose(ws as ServerWebSocket<TunnelSocketData>);
          else hub.clientWsClose(ws as ServerWebSocket<ClientWsData>, code, reason);
        },
      },
    });
    const site = hub.create("Home");
    expect(() => hub.claim("WRONG-CODE")).toThrow();
    const claim = hub.claim(site.linkCode.toLowerCase(), "Home", "test");
    siteId = claim.siteId;
    expect(() => hub.claim(site.linkCode)).toThrow();
    client = new TunnelClient({
      url: `http://127.0.0.1:${gw.port}`,
      siteId,
      secret: claim.secret,
      internalSecret: "internal",
      hello: () => ({ version: "test", cameras: 3, name: "Home" }),
      localWsBase: () => `ws://127.0.0.1:${local.port}`,
      handle: async (req, meta) => {
        const url = new URL(req.url);
        if (url.pathname === "/api/echo") return Response.json({ method: req.method, body: await req.text(), role: meta.role, q: url.searchParams.get("q"), range: req.headers.get("range") });
        if (url.pathname === "/api/big") return new Response(big, { headers: { "content-type": "application/octet-stream" } });
        if (url.pathname === "/api/slice") return new Response(Bun.file(sliceFile).slice(100, 200), { status: 206, headers: { "content-length": "100", "content-range": `bytes 100-199/${big.length}` } });
        if (url.pathname === "/api/endless") {
          let n = 0;
          return new Response(
            new ReadableStream({
              async pull(c) {
                await Bun.sleep(5);
                c.enqueue(new Uint8Array(16 * 1024).fill(n++ % 256));
              },
              cancel() {
                cancelledStreams++;
              },
            }),
          );
        }
        return new Response("missing", { status: 404 });
      },
    });
    client.start();
    for (let i = 0; i < 100 && !hub.online(siteId); i++) await Bun.sleep(20);
  });

  afterAll(() => {
    client.stop();
    gw.stop(true);
    local.stop(true);
  });

  test("site comes online and reports hello", async () => {
    expect(hub.online(siteId)).toBe(true);
    await Bun.sleep(50);
    expect(hub.list()[0]).toMatchObject({ id: siteId, online: true, cameras: 3, version: "test" });
  });

  test("request and response with body, headers and status", async () => {
    const r = await fetch(`http://127.0.0.1:${gw.port}/s/${siteId}/api/echo?q=1`, { method: "POST", body: "hello", headers: { range: "bytes=0-1" } });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ method: "POST", body: "hello", role: "admin", q: "1", range: "bytes=0-1" });
    const nf = await fetch(`http://127.0.0.1:${gw.port}/s/${siteId}/api/nope`);
    expect(nf.status).toBe(404);
    expect(await nf.text()).toBe("missing");
  });

  test("file slice is cut at content-length", async () => {
    const r = await fetch(`http://127.0.0.1:${gw.port}/s/${siteId}/api/slice`);
    expect(r.status).toBe(206);
    const buf = new Uint8Array(await r.arrayBuffer());
    expect(buf.length).toBe(100);
    expect([...buf]).toEqual([...big.subarray(100, 200)]);
  });

  test("large body streams intact with flow control", async () => {
    const r = await fetch(`http://127.0.0.1:${gw.port}/s/${siteId}/api/big`);
    const buf = new Uint8Array(await r.arrayBuffer());
    expect(buf.length).toBe(big.length);
    expect(Buffer.compare(Buffer.from(buf), Buffer.from(big))).toBe(0);
  });

  test("parallel requests are multiplexed", async () => {
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => fetch(`http://127.0.0.1:${gw.port}/s/${siteId}/api/echo?q=${i}`).then((r) => r.json() as Promise<{ q: string }>)));
    expect(rs.map((r) => r.q)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7"]);
  });

  test("client abort cancels the stream on the site", async () => {
    const ac = new AbortController();
    const r = await fetch(`http://127.0.0.1:${gw.port}/s/${siteId}/api/endless`, { signal: ac.signal });
    const reader = r.body!.getReader();
    await reader.read();
    ac.abort();
    for (let i = 0; i < 100 && cancelledStreams === 0; i++) await Bun.sleep(20);
    expect(cancelledStreams).toBeGreaterThan(0);
  });

  test("websocket passthrough", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${gw.port}/s/${siteId}/api/ws`);
    ws.binaryType = "arraybuffer";
    const got: unknown[] = [];
    ws.onopen = () => {
      ws.send("ping");
      ws.send(new Uint8Array([9, 8, 7]));
    };
    ws.onmessage = (e) => got.push(typeof e.data === "string" ? e.data : [...new Uint8Array(e.data as ArrayBuffer)]);
    for (let i = 0; i < 100 && got.length < 2; i++) await Bun.sleep(20);
    ws.close();
    expect(got).toEqual(["echo:ping", [9, 8, 7]]);
  });

  test("offline site returns 503", async () => {
    const r = await fetch(`http://127.0.0.1:${gw.port}/s/unknown/api/echo`);
    expect(r.status).toBe(503);
  });
});
