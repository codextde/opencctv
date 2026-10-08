import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { logger, errMsg } from "./log.ts";
import { slug } from "./storage/index.ts";

const log = logger("demo");

export type DemoClip = { name: string; file?: string; pattern?: string };

export function titleCase(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, "")
    .split(/[-_\s.]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function mp4sIn(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => /\.(mp4|mov|mkv)$/i.test(f) && statSync(join(dir, f)).size > 10_000)
      .sort()
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

export async function prepareDemoClips(opts: { dataDir: string; demoDir?: string; urls: { name: string; url: string }[] }): Promise<DemoClip[]> {
  const clips: DemoClip[] = [];
  if (opts.urls.length) {
    const dir = join(opts.dataDir, "demo");
    mkdirSync(dir, { recursive: true });
    for (const { name, url } of opts.urls) {
      const file = join(dir, `${slug(name)}.mp4`);
      if (!existsSync(file)) {
        try {
          log.info(`downloading demo clip ${name}`);
          const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          await Bun.write(`${file}.part`, res);
          renameSync(`${file}.part`, file);
        } catch (e) {
          log.warn(`could not download ${url}: ${errMsg(e)}`);
          continue;
        }
      }
      clips.push({ name, file });
    }
  }
  if (!clips.length) {
    const dirs = [opts.demoDir, join(opts.dataDir, "demo"), resolve("demo/media"), resolve("../demo/media")].filter((d): d is string => !!d);
    for (const d of dirs) {
      const files = mp4sIn(d);
      if (files.length) {
        for (const f of files.slice(0, 12)) clips.push({ name: titleCase(f.split(/[\\/]/).pop()!), file: f });
        log.info(`using ${files.length} demo clips from ${d}`);
        break;
      }
    }
  }
  if (!clips.length) {
    log.info("no demo clips found, using generated test patterns");
    clips.push(
      { name: "Front Door", pattern: "testsrc2=size=960x540:rate=8" },
      { name: "Driveway", pattern: "smptehdbars=size=960x540:rate=8" },
      { name: "Backyard", pattern: "testsrc=size=960x540:rate=8" },
      { name: "Garage", pattern: "mandelbrot=size=960x540:rate=8" },
    );
  }
  return clips;
}

export function demoSource(ffmpeg: string, clip: DemoClip): string {
  const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
  if (clip.file) {
    return `exec:${q(ffmpeg)} -hide_banner -loglevel error -re -stream_loop -1 -i ${q(clip.file)} -map 0:v:0 -c:v copy -an -rtsp_transport tcp -f rtsp {output}`;
  }
  return `exec:${q(ffmpeg)} -hide_banner -loglevel error -re -f lavfi -i ${clip.pattern} -c:v libx264 -preset ultrafast -tune zerolatency -g 16 -pix_fmt yuv420p -b:v 600k -an -rtsp_transport tcp -f rtsp {output}`;
}

export function demoId(name: string): string {
  return `demo-${slug(name)}`.slice(0, 40);
}
