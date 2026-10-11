import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DB } from "./db.ts";
import { deleteSetting, getSetting, setSetting } from "./db.ts";
import { findNode, installNode } from "./deps.ts";
import { freePort } from "./go2rtc.ts";
import { errMsg, logger } from "./log.ts";
import { Supervisor } from "./proc.ts";
import { HttpError, randomToken } from "./util.ts";
import WORKER_BUNDLE from "./eufy-worker.gen.ts";

const log = logger("eufy");

export type EufyStatus = "disconnected" | "connecting" | "captcha" | "2fa" | "connected" | "error";

export type EufyState = {
  status: EufyStatus;
  email?: string;
  country?: string;
  captcha?: string;
  method?: string;
  error?: string;
};

export type EufyCamera = { serial: string; name: string; model: string; battery: boolean; batteryLevel?: number; rssi?: number; station?: string };

type Account = { email: string; password: string; country: string };
type Snapshot = { state: EufyState; cameras: EufyCamera[]; warm: string[]; down: string[] };

const ACCOUNT_KEY = "eufy.account";

export type EufyHooks = {
  dir: string;
  binDir: string;
  allowDownload: boolean;
  onChange(): void;
  onMotion(serial: string, at: number): void;
  ffmpegPath?: () => string | undefined;
};

export class EufyBridge {
  private state: EufyState = { status: "disconnected" };
  private cams = new Map<string, EufyCamera>();
  private warm = new Set<string>();
  private down = new Set<string>();
  private token = randomToken(18).replace(/[^A-Za-z0-9]/g, "x");
  private port = 0;
  private node?: string;
  private sup?: Supervisor;
  private ready?: Promise<void>;
  private markReady?: () => void;

  constructor(private db: DB, private hooks: EufyHooks) {}

  get connected(): boolean {
    return this.state.status === "connected";
  }

  status(): EufyState {
    return { ...this.state };
  }

  cameras(): EufyCamera[] {
    return [...this.cams.values()];
  }

  camera(serial: string): EufyCamera | undefined {
    return this.cams.get(serial);
  }

  isWarm(serial: string): boolean {
    return this.warm.has(serial);
  }

  reachable(serial: string): boolean {
    return this.connected && this.cams.has(serial) && !this.down.has(serial);
  }

  async init(): Promise<void> {
    this.port ||= await freePort();
  }

  async start(): Promise<void> {
    const acc = getSetting<Account>(this.db, ACCOUNT_KEY);
    if (!acc) return;
    this.state = { status: "connecting", email: acc.email, country: acc.country };
    try {
      await this.call("login", acc);
    } catch (e) {
      this.fail(e, acc);
    }
  }

  async login(input: { email?: unknown; password?: unknown; country?: unknown }): Promise<EufyState> {
    const email = String(input.email ?? "").trim();
    const password = String(input.password ?? "");
    const country = String(input.country ?? "DE").trim().toUpperCase().slice(0, 2) || "DE";
    if (!email || !password) throw new HttpError(400, "Email and password are required");
    const prev = getSetting<Account>(this.db, ACCOUNT_KEY);
    const acc = { email, password, country };
    setSetting(this.db, ACCOUNT_KEY, acc);
    try {
      await this.call("login", { ...acc, fresh: !!prev && prev.email.toLowerCase() !== email.toLowerCase() });
    } catch (e) {
      this.fail(e, acc);
    }
    return this.status();
  }

  async verify(code: string): Promise<EufyState> {
    if (this.state.status !== "2fa") throw new HttpError(409, "No verification pending");
    await this.call("verify", { code: code.trim() });
    return this.status();
  }

  async solveCaptcha(answer: string): Promise<EufyState> {
    if (this.state.status !== "captcha") throw new HttpError(409, "No captcha pending");
    await this.call("captcha", { answer: answer.trim() });
    return this.status();
  }

  async refresh(): Promise<EufyCamera[]> {
    if (!this.connected) throw new HttpError(409, "Connect your eufy account first");
    await this.call("refresh", {});
    return this.cameras();
  }

  async logout(): Promise<void> {
    deleteSetting(this.db, ACCOUNT_KEY);
    if (this.sup?.running) await this.call("logout", {}).catch(() => {});
    await this.stop();
    this.apply({ state: { status: "disconnected" }, cameras: [], warm: [], down: [] });
  }

  async stop(): Promise<void> {
    const s = this.sup;
    this.sup = undefined;
    this.ready = undefined;
    await s?.stop();
  }

  sourceFor(serial: string): string | undefined {
    if (!this.port || !/^[A-Za-z0-9]+$/.test(serial)) return undefined;
    return `ffmpeg:${this.base}/live/${serial}.mp4#input=live#video=h264#width=1920#height=1080#audio=aac#audio=opus`;
  }

  async snapshot(serial: string, live = false): Promise<Uint8Array | undefined> {
    if (!this.connected || !this.sup?.running || !/^[A-Za-z0-9]+$/.test(serial)) return undefined;
    try {
      const r = await fetch(`${this.base}/snapshot/${serial}${live ? "?live=1" : ""}`, { signal: AbortSignal.timeout(live ? 45_000 : 8000) });
      if (!r.ok) return undefined;
      const buf = new Uint8Array(await r.arrayBuffer());
      return buf.length > 100 ? buf : undefined;
    } catch {
      return undefined;
    }
  }

  private get base(): string {
    return `http://127.0.0.1:${this.port}/${this.token}`;
  }

  private fail(e: unknown, acc?: { email: string; country: string }) {
    const msg = errMsg(e).slice(0, 300);
    log.warn(msg);
    this.state = { email: acc?.email ?? this.state.email, country: acc?.country ?? this.state.country, status: "error", error: msg };
    this.hooks.onChange();
  }

  private apply(s: Snapshot) {
    this.state = s.state;
    this.cams = new Map(s.cameras.map((c) => [c.serial, c]));
    this.warm = new Set(s.warm);
    this.down = new Set(s.down);
    this.hooks.onChange();
  }

  private async call(method: string, params: Record<string, unknown>): Promise<void> {
    await this.ensureWorker();
    const r = await fetch(`${this.base}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method, params }),
      signal: AbortSignal.timeout(90_000),
    });
    const j = (await r.json().catch(() => ({}))) as Partial<Snapshot> & { error?: string };
    if (!r.ok || !j.state) throw new HttpError(r.status === 400 ? 409 : 502, j.error ?? `eufy worker error (${r.status})`);
    this.apply(j as Snapshot);
  }

  private async script(): Promise<string> {
    const src = join(import.meta.dir, "eufy-worker.mjs");
    if (!WORKER_BUNDLE && existsSync(src)) return src;
    if (!WORKER_BUNDLE) throw new Error("This build does not include the eufy worker");
    const out = join(this.hooks.dir, "worker.mjs");
    writeFileSync(out, WORKER_BUNDLE);
    return out;
  }

  private ensureWorker(): Promise<void> {
    if (this.sup && this.ready) return this.ready;
    this.ready = (async () => {
      await this.init();
      mkdirSync(this.hooks.dir, { recursive: true });
      if (process.platform !== "win32") chmodSync(this.hooks.dir, 0o700);
      this.node ??= await findNode(this.hooks.binDir);
      if (!this.node && this.hooks.allowDownload) {
        log.info("eufy cameras need Node.js 24.5 or newer, downloading it once");
        this.node = await installNode(this.hooks.binDir);
      }
      if (!this.node) throw new HttpError(503, "eufy cameras need Node.js 24.5 or newer on this server. Install it or set OPENCCTV_NODE.");
      const node = this.node;
      const script = await this.script();
      const up = new Promise<void>((resolve) => (this.markReady = resolve));
      const sup = new Supervisor("eufy-worker", {
        command: () => ({
          cmd: [node, script],
          env: { EUFY_DIR: this.hooks.dir, EUFY_PORT: String(this.port), EUFY_TOKEN: this.token, EUFY_FFMPEG: this.hooks.ffmpegPath?.() ?? "" },
        }),
        onStdout: (l) => this.onLine(l),
        onStderr: (l) => log.warn(l.slice(0, 400)),
        onExit: () => {
          if (this.sup === sup) this.warm.clear();
        },
        minBackoffMs: 2000,
        maxBackoffMs: 60_000,
      });
      this.sup = sup;
      sup.start();
      const ok = await Promise.race([up.then(() => true), Bun.sleep(15_000).then(() => false)]);
      if (!ok) throw new HttpError(502, "The eufy worker did not start");
    })();
    this.ready.catch(() => {
      void this.stop();
    });
    return this.ready;
  }

  private onLine(line: string) {
    let m: { type?: string; level?: string; msg?: string; serial?: string; at?: number } & Partial<Snapshot>;
    try {
      m = JSON.parse(line);
    } catch {
      return log.debug(line.slice(0, 300));
    }
    if (m.type === "ready") {
      const restarted = !this.markReady;
      this.markReady?.();
      this.markReady = undefined;
      const acc = getSetting<Account>(this.db, ACCOUNT_KEY);
      if (restarted && acc) void this.call("login", acc).catch((e) => this.fail(e, acc));
    } else if (m.type === "log") (m.level === "info" ? log.info : log.warn)(String(m.msg));
    else if (m.type === "state" && m.state) this.apply(m as Snapshot);
    else if (m.type === "motion" && m.serial) this.hooks.onMotion(m.serial, m.at ?? Date.now());
  }
}
