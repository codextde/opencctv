import { run } from "./proc.ts";

export async function probeDuration(ffprobe: string | undefined, file: string): Promise<number | undefined> {
  if (!ffprobe) return undefined;
  const r = await run([ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { timeoutMs: 15_000 });
  if (r.code !== 0) return undefined;
  const d = Number(r.stdout.trim());
  return Number.isFinite(d) && d > 0 ? d : undefined;
}

export async function makeThumbnail(ffmpeg: string | undefined, file: string, out: string, atSec = 1): Promise<boolean> {
  if (!ffmpeg) return false;
  const r = await run(
    [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-ss", String(atSec), "-i", file, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "6", out],
    { timeoutMs: 20_000 },
  );
  return r.code === 0;
}

export type StreamProbe = { codec?: string; width?: number; height?: number; fps?: number; audio?: string };

export async function probeStream(ffprobe: string | undefined, url: string, timeoutMs = 12_000): Promise<StreamProbe | undefined> {
  if (!ffprobe) return undefined;
  const args = [ffprobe, "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate", "-of", "json"];
  if (url.startsWith("rtsp")) args.push("-rtsp_transport", "tcp");
  args.push(url);
  const r = await run(args, { timeoutMs });
  if (r.code !== 0) return undefined;
  try {
    const j = JSON.parse(r.stdout) as {
      streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string }[];
    };
    const v = j.streams?.find((s) => s.codec_type === "video");
    const a = j.streams?.find((s) => s.codec_type === "audio");
    const rate = (s?: string) => {
      if (!s) return undefined;
      const [n, d] = s.split("/").map(Number);
      return n && d ? Math.round((n / d) * 10) / 10 : undefined;
    };
    return { codec: v?.codec_name, width: v?.width, height: v?.height, fps: rate(v?.avg_frame_rate) || rate(v?.r_frame_rate), audio: a?.codec_name };
  } catch {
    return undefined;
  }
}

export function parseSegmentPath(rel: string): number | undefined {
  const m = rel.match(/(\d{4})-(\d{2})-(\d{2})[\\/](\d{2})(\d{2})(\d{2})\.mp4$/);
  if (!m) return undefined;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
}

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
