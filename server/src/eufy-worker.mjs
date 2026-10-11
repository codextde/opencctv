// Runs under Node.js (not Bun): the eufy P2P transport needs Node's UDP sockets.
import http from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { EufyMega, FileFcmStore, FileSessionStore, LoginStatus, SessionExpiredError } from "@mega-yfue/eufy-sdk";

const DIR = process.env.EUFY_DIR;
const PORT = Number(process.env.EUFY_PORT);
const TOKEN = process.env.EUFY_TOKEN;
const FFMPEG = process.env.EUFY_FFMPEG || undefined;
const MAX_LIVE_MS = 15 * 60_000;
const DOWN_MS = 2 * 60_000;
const STALL_MS = 12_000;

if (!DIR || !PORT || !TOKEN) {
  console.error("eufy worker: missing environment");
  process.exit(2);
}
mkdirSync(DIR, { recursive: true, mode: 0o700 });
const SESSION = join(DIR, "session.json");
const PUSH = join(DIR, "push.json");

let client;
let state = { status: "disconnected" };
const cams = new Map();
const viewers = new Map();
const down = new Map();
const failed = new Set();
const lastMotion = new Map();

const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const log = (level, msg) => emit({ type: "log", level, msg: String(msg).slice(0, 600) });
const errMsg = (e) => (e instanceof Error ? e.message : String(e));
const isDown = (sn) => (down.get(sn) ?? 0) > Date.now();
const snapshot = () => ({
  state,
  cameras: [...cams.values()],
  warm: [...viewers.keys()],
  down: [...failed],
});
const publish = () => emit({ type: "state", ...snapshot() });

function setDown(sn) {
  if (viewers.has(sn)) return;
  down.set(sn, Date.now() + DOWN_MS);
  failed.add(sn);
  publish();
}

function setUp(sn) {
  down.delete(sn);
  if (failed.delete(sn)) publish();
}

function open(acc) {
  const old = client;
  if (old) Promise.resolve(old.disconnect?.()).catch(() => {});
  const c = new EufyMega({
    email: acc.email,
    password: acc.password,
    countryCode: acc.country,
    store: new FileSessionStore(SESSION),
    pushStore: new FileFcmStore(PUSH),
    ffmpegPath: FFMPEG,
    noBroadcast: true,
    logger: { debug() {}, info() {}, warn: (m) => log("warn", m), error: (m) => log("warn", m) },
  });
  c.on("error", (e) => log("warn", errMsg(e)));
  c.on("sessionExpired", () => {
    if (client !== c) return;
    log("warn", "eufy session expired, signing in again");
    drive(c.login()).catch(fail);
  });
  for (const ev of ["motion", "personDetected", "vehicleDetected", "petDetection", "doorbellPress"]) c.on(ev, (e) => motion(e?.deviceSn));
  client = c;
  return c;
}

function motion(sn) {
  if (!sn || !cams.has(sn)) return;
  const now = Date.now();
  if (now - (lastMotion.get(sn) ?? 0) < 5000) return;
  lastMotion.set(sn, now);
  emit({ type: "motion", serial: sn, at: now });
}

async function refresh() {
  if (!client || state.status !== "connected") throw new Error("Connect your eufy account first");
  const list = await client.getDevices();
  cams.clear();
  for (const d of list) {
    if (d.deviceClass !== "camera") continue;
    let battery = false;
    try {
      battery = !!(await client.getDevice(d.sn)).has("battery");
    } catch {}
    const num = (v) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
    cams.set(d.sn, {
      serial: d.sn,
      name: d.name || d.sn,
      model: d.model,
      battery,
      batteryLevel: battery ? num(d.params?.[1101]) : undefined,
      rssi: num(d.params?.[1142]),
      station: d.stationSn && d.stationSn !== d.sn ? d.stationSn : undefined,
    });
  }
}

async function drive(p) {
  const r = await p;
  const base = { email: state.email, country: state.country };
  if (r.status === LoginStatus.Ok) {
    state = { ...base, status: "connected" };
    await refresh().catch((e) => log("warn", `device list: ${errMsg(e)}`));
    log("info", `eufy account connected, ${cams.size} camera(s)`);
  } else if (r.status === LoginStatus.Captcha) {
    state = { ...base, status: "captcha", captcha: r.image, error: r.retry ? "That was not right, try the new image" : undefined };
  } else if (r.status === LoginStatus.TwoFactor) {
    state = { ...base, status: "2fa", method: r.method };
  }
  publish();
}

function fail(e) {
  const wait = e instanceof SessionExpiredError && e.retryAfterMs ? ` (retry in ${Math.ceil(e.retryAfterMs / 60_000)} min)` : "";
  state = { email: state.email, country: state.country, status: "error", error: (errMsg(e) + wait).slice(0, 300) };
  log("warn", `eufy login: ${state.error}`);
  publish();
}

const rpc = {
  async login({ email, password, country, fresh }) {
    if (fresh) for (const f of [SESSION, PUSH]) rmSync(f, { force: true });
    state = { status: "connecting", email, country };
    publish();
    await drive(open({ email, password, country }).login()).catch(fail);
  },
  async verify({ code }) {
    if (!client || state.status !== "2fa") throw new Error("No verification pending");
    await drive(client.submitVerifyCode(String(code))).catch(fail);
  },
  async captcha({ answer }) {
    if (!client || state.status !== "captcha") throw new Error("No captcha pending");
    await drive(client.solveCaptcha(String(answer))).catch(fail);
  },
  async refresh() {
    await refresh();
    publish();
  },
  async logout() {
    const c = client;
    client = undefined;
    cams.clear();
    await Promise.resolve(c?.disconnect?.()).catch(() => {});
    for (const f of [SESSION, PUSH]) rmSync(f, { force: true });
    state = { status: "disconnected" };
    publish();
  },
  async state() {},
};

async function camera(sn) {
  if (!client || state.status !== "connected") return undefined;
  return (await client.getDevice(sn)).camera?.();
}

async function serveSnapshot(sn, live, res) {
  try {
    const cam = await camera(sn);
    let jpg;
    if (live) {
      if (!isDown(sn)) jpg = (await cam?.snapshotLive?.())?.jpeg;
    } else jpg = await cam?.snapshotStored?.();
    if (!jpg?.length) throw new Error("no picture");
    if (live) setUp(sn);
    res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" }).end(jpg);
  } catch (e) {
    if (live && !/no picture/.test(errMsg(e))) setDown(sn);
    res.writeHead(404).end(errMsg(e));
  }
}

async function serveLive(sn, req, res) {
  const cam = await camera(sn).catch(() => undefined);
  if (!cam?.recordFragments) return void res.writeHead(client ? 404 : 503).end("no live stream");
  if (isDown(sn)) return void res.writeHead(503).end("camera did not answer, trying again shortly");
  const name = cams.get(sn)?.name ?? sn;
  const started = Date.now();
  const ac = new AbortController();
  let closed = false;
  let current;
  let handle;
  const end = () => {
    if (closed) return;
    closed = true;
    ac.abort();
    current?.stop();
  };
  res.on("close", end);
  let it;
  let first;
  for (let attempt = 1; attempt <= 2 && !first && !closed; attempt++) {
    const h = cam.recordFragments({ fragmentSeconds: 1, signal: ac.signal });
    current = h;
    h.on("budget", (n) => {
      if (Date.now() - started < MAX_LIVE_MS) n.extend();
      else log("info", `live ${name}: stopping after ${MAX_LIVE_MS / 60_000} min to save battery`);
    });
    const i = h[Symbol.asyncIterator]();
    try {
      first = await i.next();
      handle = h;
      it = i;
    } catch (e) {
      h.stop();
      if (closed) return;
      log("warn", `live ${name}: wake attempt ${attempt} failed: ${errMsg(e)}`);
      if (attempt === 2) {
        setDown(sn);
        return void res.writeHead(504).end("camera did not answer");
      }
    }
  }
  if (!handle || !it || !first || first.done) {
    handle?.stop();
    if (!closed) res.writeHead(504).end("camera sent no video");
    return;
  }
  viewers.set(sn, (viewers.get(sn) ?? 0) + 1);
  failed.delete(sn);
  down.delete(sn);
  publish();
  log("info", `live ${name}: started after ${((Date.now() - started) / 1000).toFixed(1)}s`);
  res.writeHead(200, { "content-type": "video/mp4", "cache-control": "no-store" });
  const write = (buf) =>
    new Promise((resolve) => {
      if (closed || !buf?.length) return resolve();
      if (res.write(buf)) return resolve();
      res.once("drain", resolve);
      res.once("close", resolve);
    });
  let last = Date.now();
  let cleaned = false;
  const watchdog = setInterval(() => {
    if (Date.now() - last < STALL_MS) return;
    log("warn", `live ${name}: no video for ${STALL_MS / 1000}s, reconnecting`);
    end();
    res.destroy();
  }, 2000);
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(watchdog);
    handle.stop();
    const n = (viewers.get(sn) ?? 1) - 1;
    if (n > 0) viewers.set(sn, n);
    else viewers.delete(sn);
    publish();
    log("info", `live ${name}: stopped after ${Math.round((Date.now() - started) / 1000)}s`);
    if (!res.destroyed) res.end();
  };
  res.on("close", cleanup);
  try {
    let r = first;
    while (!r.done && !closed) {
      last = Date.now();
      await write(r.value.init);
      await write(r.value.data);
      r = await it.next();
    }
  } catch (e) {
    if (!closed) log("warn", `live ${name}: ${errMsg(e)}`);
  } finally {
    cleanup();
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (c) => {
      s += c;
      if (s.length > 100_000) reject(new Error("too large"));
    });
    req.on("end", () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] !== TOKEN) return void res.writeHead(404).end();
  try {
    if (req.method === "POST" && parts[1] === "rpc") {
      const { method, params } = await readBody(req);
      if (!Object.hasOwn(rpc, method)) throw new Error(`unknown method ${method}`);
      await rpc[method](params ?? {});
      return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(snapshot()));
    }
    if (req.method === "GET" && parts[1] === "live" && parts[2]) return void (await serveLive(parts[2].replace(/\.mp4$/, ""), req, res));
    if (req.method === "GET" && parts[1] === "snapshot" && parts[2]) return void (await serveSnapshot(parts[2], url.searchParams.get("live") === "1", res));
    res.writeHead(404).end();
  } catch (e) {
    if (!res.headersSent) res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: errMsg(e) }));
  }
});

server.listen(PORT, "127.0.0.1", () => emit({ type: "ready" }));

const parent = process.ppid;
setInterval(() => {
  if (process.ppid !== parent) process.exit(0);
}, 2000).unref();
process.on("unhandledRejection", (e) => log("warn", `unhandled: ${errMsg(e)}`));
for (const sig of ["SIGTERM", "SIGINT"])
  process.on(sig, () => {
    Promise.resolve(client?.disconnect?.())
      .catch(() => {})
      .finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
