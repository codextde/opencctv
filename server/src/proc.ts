import type { Subprocess } from "bun";
import { logger, errMsg, type Logger } from "./log.ts";

export async function readLines(stream: ReadableStream<Uint8Array> | null | undefined, onLine: (line: string) => void): Promise<void> {
  if (!stream) return;
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for await (const chunk of stream) {
      buf += decoder.decode(chunk, { stream: true });
      let idx: number;
      while ((idx = buf.search(/[\r\n]/)) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line) onLine(line);
      }
      if (buf.length > 65536) buf = buf.slice(-4096);
    }
  } catch {}
  if (buf) onLine(buf);
}

export type SupervisorOpts = {
  command: () => { cmd: string[]; env?: Record<string, string | undefined>; cwd?: string } | undefined;
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
  onStart?: () => void;
  onExit?: (code: number | null) => void;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  healthyAfterMs?: number;
};

export class Supervisor {
  private proc?: Subprocess<"ignore", "pipe", "pipe">;
  private stopped = true;
  private backoff: number;
  private timer?: ReturnType<typeof setTimeout>;
  private startedAt = 0;
  lastError?: string;
  restarts = 0;
  readonly log: Logger;

  constructor(readonly name: string, private opts: SupervisorOpts) {
    this.backoff = opts.minBackoffMs ?? 2000;
    this.log = logger(name);
  }

  get running(): boolean {
    return !!this.proc && this.proc.exitCode === null;
  }

  get pid(): number | undefined {
    return this.proc?.pid;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.spawn();
  }

  private spawn(): void {
    if (this.stopped) return;
    const spec = this.opts.command();
    if (!spec) {
      this.lastError = "not configured";
      return;
    }
    try {
      const proc = Bun.spawn(spec.cmd, {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      this.proc = proc;
      this.startedAt = Date.now();
      this.opts.onStart?.();
      void readLines(proc.stdout, (l) => this.opts.onStdout?.(l));
      void readLines(proc.stderr, (l) => {
        this.opts.onStderr?.(l);
      });
      void proc.exited.then((code) => this.handleExit(proc, code));
    } catch (e) {
      this.lastError = errMsg(e);
      this.log.error(`spawn failed: ${this.lastError}`);
      this.schedule();
    }
  }

  private handleExit(proc: Subprocess, code: number | null) {
    if (this.proc !== proc) return;
    this.proc = undefined;
    this.opts.onExit?.(code);
    if (this.stopped) return;
    const ranFor = Date.now() - this.startedAt;
    if (ranFor > (this.opts.healthyAfterMs ?? 30_000)) this.backoff = this.opts.minBackoffMs ?? 2000;
    this.log.warn(`exited with code ${code}, restarting in ${Math.round(this.backoff / 1000)}s`);
    this.restarts++;
    this.schedule();
  }

  private schedule() {
    clearTimeout(this.timer);
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, this.opts.maxBackoffMs ?? 60_000);
    this.timer = setTimeout(() => this.spawn(), delay);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    const p = this.proc;
    this.proc = undefined;
    if (!p) return;
    p.kill("SIGINT");
    const done = await Promise.race([p.exited.then(() => true), Bun.sleep(5000).then(() => false)]);
    if (!done) {
      p.kill("SIGKILL");
      await p.exited;
    }
    this.opts.onExit?.(p.exitCode);
  }

  async restart(): Promise<void> {
    await this.stop();
    this.backoff = this.opts.minBackoffMs ?? 2000;
    this.start();
  }
}

export async function run(
  cmd: string[],
  opts: { timeoutMs?: number; stdin?: string; env?: Record<string, string | undefined>; cwd?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const p = Bun.spawn(cmd, {
    stdin: opts.stdin !== undefined ? new TextEncoder().encode(opts.stdin) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...opts.env },
    cwd: opts.cwd,
  });
  let timedOut = false;
  const timer = opts.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        p.kill("SIGKILL");
      }, opts.timeoutMs)
    : undefined;
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  clearTimeout(timer);
  return { code: timedOut ? -1 : code, stdout, stderr: timedOut ? `timeout after ${opts.timeoutMs}ms\n${stderr}` : stderr };
}

export const noopLogger = logger("proc");
