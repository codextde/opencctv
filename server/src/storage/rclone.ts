import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "../proc.ts";
import { sha256 } from "../util.ts";
import { iniSection, rcloneSection, type TargetType } from "./types.ts";

export class Rclone {
  private obscured = new Map<string, string>();

  constructor(readonly bin: string | undefined, private confDir: string) {
    mkdirSync(confDir, { recursive: true });
  }

  get available(): boolean {
    return !!this.bin;
  }

  confPath(targetId: string): string {
    return join(this.confDir, `${targetId}.conf`);
  }

  async obscure(plain: string): Promise<string> {
    if (!plain) return "";
    const key = sha256(plain);
    const hit = this.obscured.get(key);
    if (hit) return hit;
    const r = await run([this.requireBin(), "obscure", "-"], { stdin: plain, timeoutMs: 10_000 });
    if (r.code !== 0) throw new Error(`rclone obscure failed: ${r.stderr.trim()}`);
    const out = r.stdout.trim();
    this.obscured.set(key, out);
    return out;
  }

  private requireBin(): string {
    if (!this.bin) throw new Error("rclone is not installed");
    return this.bin;
  }

  async writeConfig(targetId: string, type: TargetType, config: Record<string, string>): Promise<string> {
    const secrets: string[] = [];
    for (const k of ["password"]) if (config[k]) secrets.push(config[k]!);
    const obs = new Map<string, string>();
    for (const s of secrets) obs.set(s, await this.obscure(s));
    const section = rcloneSection(type, config, (s) => obs.get(s) ?? "");
    const path = this.confPath(targetId);
    writeFileSync(path, iniSection("t", section), { mode: 0o600 });
    return path;
  }

  removeConfig(targetId: string): void {
    rmSync(this.confPath(targetId), { force: true });
  }

  async exec(targetId: string, args: string[], opts: { timeoutMs?: number; stdin?: string } = {}) {
    return run([this.requireBin(), "--config", this.confPath(targetId), "--use-json-log", "--log-level", "ERROR", ...args], {
      timeoutMs: opts.timeoutMs ?? 120_000,
      stdin: opts.stdin,
    });
  }

  spawnCat(targetId: string, remotePath: string, offset: number, count: number) {
    const args = [this.requireBin(), "--config", this.confPath(targetId), "--log-level", "ERROR", "cat", `t:${remotePath}`];
    if (offset > 0) args.push("--offset", String(offset));
    if (count >= 0) args.push("--count", String(count));
    return Bun.spawn(args, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  }
}

export function rcloneError(stderr: string): string {
  const lines = stderr
    .split("\n")
    .map((l) => {
      try {
        const j = JSON.parse(l) as { msg?: string };
        return j.msg ?? l;
      } catch {
        return l;
      }
    })
    .map((l) => l.trim())
    .filter(Boolean);
  return (lines.find((l) => /error|failed|denied|refused|not found|invalid|couldn't|can't/i.test(l)) ?? lines[lines.length - 1] ?? "rclone failed").slice(0, 400);
}
