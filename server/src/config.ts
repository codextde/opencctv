import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import pkg from "../package.json" with { type: "json" };

export const VERSION: string = pkg.version;

declare const OPENCCTV_BUILTIN_GOOGLE_CLIENT_ID: string | undefined;
declare const OPENCCTV_BUILTIN_GOOGLE_CLIENT_SECRET: string | undefined;
const builtinGoogle = {
  id: typeof OPENCCTV_BUILTIN_GOOGLE_CLIENT_ID === "string" ? OPENCCTV_BUILTIN_GOOGLE_CLIENT_ID : undefined,
  secret: typeof OPENCCTV_BUILTIN_GOOGLE_CLIENT_SECRET === "string" ? OPENCCTV_BUILTIN_GOOGLE_CLIENT_SECRET : undefined,
};

export type Config = {
  dataDir: string;
  port: number;
  host: string;
  publicUrl?: string;
  demo: boolean;
  demoDir?: string;
  demoUrls: { name: string; url: string }[];
  adminUser?: string;
  adminPassword?: string;
  google: { clientId?: string; clientSecret?: string; webClientId?: string; webClientSecret?: string };
  rtspPort: number;
  rtmpPort: number;
  webrtcPort: number;
  rtspPublic: boolean;
  noDownload: boolean;
};

function defaultDataDir(): string {
  if (process.env.OPENCCTV_DOCKER === "1") return "/data";
  if (platform() === "win32") return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "OpenCCTV");
  return join(homedir(), ".opencctv");
}

export function parseDemoUrls(raw: string | undefined): { name: string; url: string }[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry, i) => {
      const bar = entry.indexOf("|");
      if (bar === -1) return { name: `Camera ${i + 1}`, url: entry };
      return { name: entry.slice(0, bar).trim() || `Camera ${i + 1}`, url: entry.slice(bar + 1).trim() };
    })
    .filter((e) => /^https?:\/\//.test(e.url));
}

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i !== -1) return args[i + 1];
  const pref = args.find((a) => a.startsWith(name + "="));
  return pref ? pref.slice(name.length + 1) : undefined;
}

const env = (k: string) => {
  const v = process.env[k];
  return v === undefined || v === "" ? undefined : v;
};

export function loadConfig(args: string[] = process.argv.slice(2)): Config {
  const dataDir = resolve(argValue(args, "--data") ?? env("OPENCCTV_DATA") ?? defaultDataDir());
  mkdirSync(dataDir, { recursive: true });
  const port = Number(argValue(args, "--port") ?? env("OPENCCTV_PORT") ?? 8080);
  const publicUrl = env("OPENCCTV_PUBLIC_URL")?.replace(/\/+$/, "");
  return {
    dataDir,
    port,
    host: env("OPENCCTV_HOST") ?? "0.0.0.0",
    publicUrl,
    demo: env("OPENCCTV_DEMO") === "1" || env("OPENCCTV_DEMO") === "true" || args.includes("--demo"),
    demoDir: env("OPENCCTV_DEMO_DIR"),
    demoUrls: parseDemoUrls(env("OPENCCTV_DEMO_URLS")),
    adminUser: env("OPENCCTV_ADMIN_USER"),
    adminPassword: env("OPENCCTV_ADMIN_PASSWORD"),
    google: {
      clientId: env("OPENCCTV_GOOGLE_CLIENT_ID") ?? builtinGoogle.id,
      clientSecret: env("OPENCCTV_GOOGLE_CLIENT_ID") ? env("OPENCCTV_GOOGLE_CLIENT_SECRET") : builtinGoogle.secret,
      webClientId: env("OPENCCTV_GOOGLE_WEB_CLIENT_ID"),
      webClientSecret: env("OPENCCTV_GOOGLE_WEB_CLIENT_SECRET"),
    },
    rtspPort: Number(env("OPENCCTV_RTSP_PORT") ?? 8554),
    rtmpPort: Number(env("OPENCCTV_RTMP_PORT") ?? 1935),
    webrtcPort: Number(env("OPENCCTV_WEBRTC_PORT") ?? 8555),
    rtspPublic: env("OPENCCTV_RTSP_PUBLIC") === "1",
    noDownload: env("OPENCCTV_NO_DOWNLOAD") === "1",
  };
}

export function dataPath(cfg: Config, ...parts: string[]): string {
  return join(cfg.dataDir, ...parts);
}
