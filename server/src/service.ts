import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { basename, dirname, join } from "node:path";
import { run } from "./proc.ts";
import type { Config } from "./config.ts";

function launchCommand(cfg: Config): string[] {
  const compiled = !/^bun(\.exe)?$/i.test(basename(process.execPath));
  const base = compiled ? [process.execPath] : [process.execPath, Bun.main];
  return [...base, "serve", "--data", cfg.dataDir, "--port", String(cfg.port)];
}

const xml = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
const LABEL = "de.codext.opencctv";

export async function installService(cfg: Config): Promise<string> {
  const cmd = launchCommand(cfg);
  if (process.platform === "linux") {
    const root = process.getuid?.() === 0;
    const unitDir = root ? "/etc/systemd/system" : join(homedir(), ".config/systemd/user");
    mkdirSync(unitDir, { recursive: true });
    const unit = [
      "[Unit]",
      "Description=OpenCCTV camera server",
      "After=network-online.target",
      "Wants=network-online.target",
      "",
      "[Service]",
      `ExecStart=${cmd.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`,
      "Restart=always",
      "RestartSec=5",
      root ? `User=${process.env.SUDO_USER || "root"}` : "",
      "Environment=OPENCCTV_QUIET=0",
      "",
      "[Install]",
      `WantedBy=${root ? "multi-user.target" : "default.target"}`,
      "",
    ]
      .filter((l) => l !== "" || true)
      .join("\n");
    const path = join(unitDir, "opencctv.service");
    writeFileSync(path, unit);
    const sc = root ? ["systemctl"] : ["systemctl", "--user"];
    await run([...sc, "daemon-reload"]);
    const r = await run([...sc, "enable", "--now", "opencctv.service"]);
    if (r.code !== 0) throw new Error(r.stderr.trim());
    if (!root) await run(["loginctl", "enable-linger", userInfo().username]).catch(() => undefined);
    return `Installed systemd unit ${path} and started it.`;
  }
  if (process.platform === "darwin") {
    const path = join(homedir(), "Library/LaunchAgents", `${LABEL}.plist`);
    mkdirSync(dirname(path), { recursive: true });
    const logFile = join(cfg.dataDir, "opencctv.log");
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${cmd.map((a) => `    <string>${xml(a)}</string>`).join("\n")}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>StandardOutPath</key><string>${xml(logFile)}</string>
  <key>StandardErrorPath</key><string>${xml(logFile)}</string>
</dict>
</plist>
`;
    if (existsSync(path)) await run(["launchctl", "unload", path]);
    writeFileSync(path, plist);
    const r = await run(["launchctl", "load", "-w", path]);
    if (r.code !== 0) throw new Error(r.stderr.trim());
    return `Installed launch agent ${path}. Logs: ${logFile}`;
  }
  if (process.platform === "win32") {
    const tr = cmd.map((a) => `"${a}"`).join(" ");
    const r = await run(["schtasks", "/Create", "/TN", "OpenCCTV", "/TR", tr, "/SC", "ONLOGON", "/RL", "LIMITED", "/F"]);
    if (r.code !== 0) throw new Error(r.stderr.trim() || r.stdout.trim());
    await run(["schtasks", "/Run", "/TN", "OpenCCTV"]);
    return "Installed scheduled task OpenCCTV (runs at logon) and started it.";
  }
  throw new Error(`Unsupported platform ${process.platform}`);
}

export async function uninstallService(): Promise<string> {
  if (process.platform === "linux") {
    const root = process.getuid?.() === 0;
    const sc = root ? ["systemctl"] : ["systemctl", "--user"];
    await run([...sc, "disable", "--now", "opencctv.service"]);
    const path = root ? "/etc/systemd/system/opencctv.service" : join(homedir(), ".config/systemd/user/opencctv.service");
    rmSync(path, { force: true });
    await run([...sc, "daemon-reload"]);
    return `Removed ${path}.`;
  }
  if (process.platform === "darwin") {
    const path = join(homedir(), "Library/LaunchAgents", `${LABEL}.plist`);
    if (existsSync(path)) await run(["launchctl", "unload", "-w", path]);
    rmSync(path, { force: true });
    return `Removed ${path}.`;
  }
  if (process.platform === "win32") {
    await run(["schtasks", "/End", "/TN", "OpenCCTV"]);
    const r = await run(["schtasks", "/Delete", "/TN", "OpenCCTV", "/F"]);
    if (r.code !== 0) throw new Error(r.stderr.trim());
    return "Removed scheduled task OpenCCTV.";
  }
  throw new Error(`Unsupported platform ${process.platform}`);
}
