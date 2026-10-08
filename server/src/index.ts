#!/usr/bin/env bun
import { VERSION, loadConfig } from "./config.ts";
import { logger, errMsg } from "./log.ts";

const HELP = `OpenCCTV ${VERSION} - open-source camera server, NVR and remote gateway

Usage:
  opencctv [serve] [--data DIR] [--port PORT] [--demo]   Start the server (default)
  opencctv service install [--data DIR] [--port PORT]    Run at boot/logon (systemd, launchd, Task Scheduler)
  opencctv service uninstall                             Remove the service
  opencctv reset-password <username> [new-password]      Reset a user's password
  opencctv --version                                     Print the version

Environment:
  OPENCCTV_DATA, OPENCCTV_PORT, OPENCCTV_PUBLIC_URL, OPENCCTV_ADMIN_USER, OPENCCTV_ADMIN_PASSWORD,
  OPENCCTV_DEMO, OPENCCTV_DEMO_DIR, OPENCCTV_DEMO_URLS, OPENCCTV_GOOGLE_CLIENT_ID, OPENCCTV_GOOGLE_CLIENT_SECRET
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--version") || args.includes("-v")) {
    console.log(VERSION);
    return;
  }
  if (args.includes("--help") || args.includes("-h") || args[0] === "help") {
    console.log(HELP);
    return;
  }
  const cmd = args[0] && !args[0].startsWith("-") ? args[0] : "serve";
  const cfg = loadConfig(args);

  if (cmd === "healthcheck") {
    const res = await fetch(`http://127.0.0.1:${cfg.port}/healthz`, { signal: AbortSignal.timeout(4000) }).catch(() => undefined);
    process.exit(res?.ok ? 0 : 1);
  }

  if (cmd === "service") {
    const { installService, uninstallService } = await import("./service.ts");
    const sub = args[1];
    if (sub === "install") console.log(await installService(cfg));
    else if (sub === "uninstall") console.log(await uninstallService());
    else console.log(HELP);
    return;
  }

  if (cmd === "reset-password") {
    const username = args[1];
    if (!username) throw new Error("Usage: opencctv reset-password <username> [new-password]");
    const { openDb } = await import("./db.ts");
    const { Auth } = await import("./auth.ts");
    const { randomToken } = await import("./util.ts");
    const db = openDb(`${cfg.dataDir}/opencctv.db`);
    const auth = new Auth(db);
    const pw = args[2] && !args[2].startsWith("--") ? args[2] : randomToken(9);
    await auth.resetPassword(username, pw);
    db.close();
    console.log(`Password for ${username} reset${args[2] ? "" : `. New password: ${pw}`}`);
    return;
  }

  if (cmd !== "serve") {
    console.log(HELP);
    process.exitCode = 1;
    return;
  }

  const crashLog = logger("process");
  process.on("unhandledRejection", (e) => crashLog.error(`unhandled rejection: ${errMsg(e)}`));
  process.on("uncaughtException", (e) => crashLog.error(`uncaught exception: ${errMsg(e)}`));
  const { App } = await import("./app.ts");
  const { startServer } = await import("./http/server.ts");
  const log = logger("main");
  const app = new App(cfg);
  await app.bootstrapUsers();
  const server = startServer(app);
  log.info(`listening on http://${cfg.host === "0.0.0.0" ? "localhost" : cfg.host}:${server.port}`);
  await app.start();
  log.info("ready");

  let stopping = false;
  const shutdown = async (sig: string) => {
    if (stopping) return;
    stopping = true;
    log.info(`${sig} received, shutting down`);
    const force = setTimeout(() => process.exit(1), 15_000);
    try {
      server.stop(true);
      await app.stop();
    } catch (e) {
      log.error(errMsg(e));
    }
    clearTimeout(force);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((e) => {
  console.error(errMsg(e));
  process.exit(1);
});
