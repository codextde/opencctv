import { existsSync, mkdirSync, chmodSync, renameSync, rmSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { logger, errMsg } from "./log.ts";

const log = logger("deps");

export const GO2RTC_VERSION = "1.9.14";

export type BinName = "go2rtc" | "ffmpeg" | "ffprobe" | "rclone";
export type Binaries = Record<BinName, string | undefined>;

const exe = (name: string) => (process.platform === "win32" ? `${name}.exe` : name);

function candidates(name: BinName, binDir: string): string[] {
  const out: string[] = [];
  const envKey = `OPENCCTV_${name.toUpperCase()}`;
  if (process.env[envKey]) out.push(process.env[envKey]!);
  out.push(join(binDir, exe(name)));
  out.push(join(dirname(process.execPath), exe(name)));
  const which = Bun.which(name);
  if (which) out.push(which);
  if (process.platform === "darwin") out.push(`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`);
  if (process.platform === "linux") out.push(`/usr/bin/${name}`, `/usr/local/bin/${name}`);
  return out;
}

export function findBinary(name: BinName, binDir: string): string | undefined {
  for (const c of candidates(name, binDir)) {
    try {
      if (c && existsSync(c) && statSync(c).isFile()) return c;
    } catch {}
  }
  return undefined;
}

function archName(): "amd64" | "arm64" {
  return process.arch === "arm64" ? "arm64" : "amd64";
}

async function download(url: string, label: string): Promise<Uint8Array> {
  log.info(`Downloading ${label} from ${url}`);
  const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "opencctv" } });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
  const total = Number(res.headers.get("content-length") || 0);
  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastPct = -10;
  for await (const chunk of res.body) {
    chunks.push(chunk);
    received += chunk.length;
    if (total) {
      const pct = Math.floor((received / total) * 100);
      if (pct >= lastPct + 10) {
        lastPct = pct;
        log.info(`${label}: ${pct}% (${(received / 1e6).toFixed(1)} MB)`);
      }
    }
  }
  const buf = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  log.info(`${label}: downloaded ${(received / 1e6).toFixed(1)} MB`);
  return buf;
}

export function unzipEntries(buf: Uint8Array): { name: string; data: () => Uint8Array }[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip file");
  let count = dv.getUint16(eocd + 10, true);
  let cdOffset = dv.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff || count === 0xffff) {
    const loc = eocd - 20;
    if (dv.getUint32(loc, true) !== 0x07064b50) throw new Error("Zip64 locator missing");
    const z64 = Number(dv.getBigUint64(loc + 8, true));
    count = Number(dv.getBigUint64(z64 + 32, true));
    cdOffset = Number(dv.getBigUint64(z64 + 48, true));
  }
  const entries: { name: string; data: () => Uint8Array }[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Bad central directory");
    const method = dv.getUint16(p + 10, true);
    let compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    let localOff = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e < extraEnd) {
      const id = dv.getUint16(e, true);
      const size = dv.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (dv.getUint32(p + 24, true) === 0xffffffff) q += 8;
        if (compSize === 0xffffffff) {
          compSize = Number(dv.getBigUint64(q, true));
          q += 8;
        }
        if (localOff === 0xffffffff) localOff = Number(dv.getBigUint64(q, true));
      }
      e += 4 + size;
    }
    const cs = compSize;
    const lo = localOff;
    entries.push({
      name,
      data: () => {
        const ln = dv.getUint16(lo + 26, true);
        const le = dv.getUint16(lo + 28, true);
        const start = lo + 30 + ln + le;
        const raw = buf.subarray(start, start + cs);
        if (method === 0) return raw;
        if (method === 8) return new Uint8Array(inflateRawSync(raw));
        throw new Error(`Unsupported zip compression ${method}`);
      },
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function writeExecutable(path: string, data: Uint8Array) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data);
  if (process.platform !== "win32") chmodSync(tmp, 0o755);
  renameSync(tmp, path);
}

function extractFromZip(buf: Uint8Array, wanted: string[], binDir: string) {
  const entries = unzipEntries(buf);
  for (const w of wanted) {
    const e = entries.find((x) => x.name.split("/").pop() === w);
    if (!e) throw new Error(`${w} not found in archive`);
    writeExecutable(join(binDir, w), e.data());
  }
}

async function extractTarXz(buf: Uint8Array, wanted: string[], binDir: string) {
  const tmp = join(binDir, `.extract-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  try {
    const archive = join(tmp, "a.tar.xz");
    writeFileSync(archive, buf);
    const p = Bun.spawn(["tar", "-xJf", archive, "-C", tmp], { stderr: "pipe" });
    if ((await p.exited) !== 0) throw new Error(`tar failed: ${await new Response(p.stderr).text()}`);
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        const f = join(d, n);
        return statSync(f).isDirectory() ? walk(f) : [f];
      });
    const files = walk(tmp);
    for (const w of wanted) {
      const f = files.find((x) => x.endsWith(`/bin/${w}`) || x.endsWith(`/${w}`));
      if (!f) throw new Error(`${w} not found in archive`);
      writeExecutable(join(binDir, w), new Uint8Array(await Bun.file(f).arrayBuffer()));
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function installGo2rtc(binDir: string) {
  const a = archName();
  const base = `https://github.com/AlexxIT/go2rtc/releases/download/v${GO2RTC_VERSION}`;
  if (process.platform === "linux") {
    writeExecutable(join(binDir, "go2rtc"), await download(`${base}/go2rtc_linux_${a}`, "go2rtc"));
  } else if (process.platform === "darwin") {
    extractFromZip(await download(`${base}/go2rtc_mac_${a}.zip`, "go2rtc"), ["go2rtc"], binDir);
  } else if (process.platform === "win32") {
    const name = a === "arm64" ? "go2rtc_win_arm64.zip" : "go2rtc_win64.zip";
    extractFromZip(await download(`${base}/${name}`, "go2rtc"), ["go2rtc.exe"], binDir);
  } else throw new Error(`No go2rtc build for ${process.platform}`);
}

async function installRclone(binDir: string) {
  const os = process.platform === "darwin" ? "osx" : process.platform === "win32" ? "windows" : "linux";
  const url = `https://downloads.rclone.org/rclone-current-${os}-${archName()}.zip`;
  extractFromZip(await download(url, "rclone"), [exe("rclone")], binDir);
}

async function installFfmpeg(binDir: string) {
  const a = archName();
  const btbn = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest";
  if (process.platform === "linux") {
    const name = a === "arm64" ? "ffmpeg-master-latest-linuxarm64-gpl.tar.xz" : "ffmpeg-master-latest-linux64-gpl.tar.xz";
    await extractTarXz(await download(`${btbn}/${name}`, "ffmpeg"), ["ffmpeg", "ffprobe"], binDir);
  } else if (process.platform === "win32") {
    const name = a === "arm64" ? "ffmpeg-master-latest-winarm64-gpl.zip" : "ffmpeg-master-latest-win64-gpl.zip";
    extractFromZip(await download(`${btbn}/${name}`, "ffmpeg"), ["ffmpeg.exe", "ffprobe.exe"], binDir);
  } else if (process.platform === "darwin") {
    if (a === "arm64") log.warn("No official static ffmpeg for Apple Silicon. Installing the Intel build from evermeet.cx (needs Rosetta). Recommended: brew install ffmpeg");
    extractFromZip(await download("https://evermeet.cx/ffmpeg/getrelease/zip", "ffmpeg"), ["ffmpeg"], binDir);
    extractFromZip(await download("https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip", "ffprobe"), ["ffprobe"], binDir);
  } else throw new Error(`No ffmpeg build for ${process.platform}`);
}

export async function ensureBinaries(binDir: string, allowDownload: boolean): Promise<Binaries> {
  mkdirSync(binDir, { recursive: true });
  const installers: Record<"go2rtc" | "ffmpeg" | "rclone", (d: string) => Promise<void>> = {
    go2rtc: installGo2rtc,
    ffmpeg: installFfmpeg,
    rclone: installRclone,
  };
  for (const name of ["go2rtc", "ffmpeg", "rclone"] as const) {
    if (findBinary(name, binDir)) continue;
    if (!allowDownload) {
      log.warn(`${name} not found and downloads are disabled`);
      continue;
    }
    try {
      await installers[name](binDir);
    } catch (e) {
      log.error(`Could not install ${name}: ${errMsg(e)}${name === "ffmpeg" && process.platform === "darwin" ? " (try: brew install ffmpeg)" : ""}`);
    }
  }
  const bins: Binaries = {
    go2rtc: findBinary("go2rtc", binDir),
    ffmpeg: findBinary("ffmpeg", binDir),
    ffprobe: findBinary("ffprobe", binDir),
    rclone: findBinary("rclone", binDir),
  };
  for (const [k, v] of Object.entries(bins)) log.info(`${k}: ${v ?? "missing"}`);
  return bins;
}

export async function binaryVersion(path: string | undefined, name: BinName): Promise<string | undefined> {
  if (!path) return undefined;
  const args = name === "go2rtc" ? ["-version"] : name === "rclone" ? ["version"] : ["-version"];
  try {
    const p = Bun.spawn([path, ...args], { stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => p.kill(), 5000);
    const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
    clearTimeout(timer);
    await p.exited;
    const m =
      name === "go2rtc"
        ? out.match(/version[=: ]+v?([\w.\-]+)/i) ?? out.match(/(\d+\.\d+\.\d+)/)
        : name === "rclone"
          ? out.match(/rclone v([\w.\-]+)/)
          : out.match(/version (\S+)/);
    return m?.[1] ?? out.split("\n")[0]?.slice(0, 60);
  } catch {
    return undefined;
  }
}
