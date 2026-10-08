import { describe, expect, test } from "bun:test";
import { parseRange, rewritePlaylist, safeJoin, serveFile } from "../src/http/media.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSegmentPath } from "../src/media.ts";
import { buildGo2rtcYaml, codecSummary } from "../src/go2rtc.ts";
import { buildRecordArgs } from "../src/recorder.ts";

describe("HLS playlist rewrite", () => {
  test("master playlist child carries token", () => {
    const src = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=192000,CODECS="avc1.4D401F"\nhls/playlist.m3u8?id=abc\n';
    expect(rewritePlaylist(src, "t/k=n")).toBe('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=192000,CODECS="avc1.4D401F"\nhls/playlist.m3u8?id=abc&token=t%2Fk%3Dn\n');
  });
  test("media playlist with map and segments", () => {
    const src = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4?id=x"\n#EXTINF:0.5,\nsegment.m4s?id=x&n=1\nsegment.ts\n';
    const out = rewritePlaylist(src, "T");
    expect(out).toContain('#EXT-X-MAP:URI="init.mp4?id=x&token=T"');
    expect(out).toContain("segment.m4s?id=x&n=1&token=T");
    expect(out).toContain("segment.ts?token=T");
  });
  test("absolute URLs untouched, no token no change", () => {
    expect(rewritePlaylist("https://cdn/x.ts\n", "T")).toBe("https://cdn/x.ts\n");
    expect(rewritePlaylist("a.ts\n", undefined)).toBe("a.ts\n");
  });
});

describe("serveFile", () => {
  const dir = mkdtempSync(join(tmpdir(), "occ-media-"));
  const file = join(dir, "v.mp4");
  const data = new Uint8Array(5000).map((_, i) => i % 251);
  writeFileSync(file, data);
  const read = async (res: Response) => new Uint8Array(await res.arrayBuffer());
  test("range response has exactly the requested bytes", async () => {
    const res = serveFile(file, new Request("http://x/", { headers: { range: "bytes=100-199" } }), "video/mp4");
    expect(res.status).toBe(206);
    expect(res.headers.get("content-length")).toBe("100");
    expect(res.headers.get("content-range")).toBe("bytes 100-199/5000");
    expect([...(await read(res))]).toEqual([...data.subarray(100, 200)]);
  });
  test("full body and invalid range", async () => {
    const res = serveFile(file, new Request("http://x/"), "video/mp4");
    expect(res.status).toBe(200);
    expect((await read(res)).length).toBe(5000);
    expect(serveFile(file, new Request("http://x/", { headers: { range: "bytes=6000-" } }), "video/mp4").status).toBe(416);
  });
});

describe("Range parsing", () => {
  test("variants", () => {
    expect(parseRange(null, 100)).toBeUndefined();
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=50-500", 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange("bytes=100-", 100)).toBe("invalid");
    expect(parseRange("bytes=5-1", 100)).toBe("invalid");
    expect(parseRange("items=0-1", 100)).toBe("invalid");
  });
});

describe("paths", () => {
  test("safeJoin blocks traversal", () => {
    expect(safeJoin("/data/rec", "cam/2026-01-01/000000.mp4")).toBe("/data/rec/cam/2026-01-01/000000.mp4");
    expect(safeJoin("/data/rec", "../opencctv.db")).toBeUndefined();
    expect(safeJoin("/data/rec", "/etc/passwd")).toBeUndefined();
  });
  test("segment path to UTC time", () => {
    expect(parseSegmentPath("cam/2026-10-08/154410.mp4")).toBe(Date.UTC(2026, 9, 8, 15, 44, 10));
    expect(parseSegmentPath("cam/foo.mp4")).toBeUndefined();
  });
});

describe("go2rtc config and recorder args", () => {
  test("yaml quotes values and binds API to localhost", () => {
    const y = buildGo2rtcYaml({ apiPort: 1999, rtspListen: "127.0.0.1:8554", rtspUser: "u", rtspPass: 'p"q', streams: [{ name: "cam1", sources: ["rtsp://a:b@h/x"] }, { name: "bad name", sources: ["x"] }, { name: "push_1", sources: [] }] });
    expect(y).toContain('listen: "127.0.0.1:1999"');
    expect(y).toContain('password: "p\\"q"');
    expect(y).toContain('    - "rtsp://a:b@h/x"');
    expect(y).not.toContain("bad name");
    expect(y).toContain("  push_1: []");
  });
  test("codec summary", () => {
    const s = codecSummary({ producers: [{ bytes_recv: 10, receivers: [{ codec: { codec_name: "h264", codec_type: "video" } }, { codec: { codec_name: "pcm_alaw", codec_type: "audio" } }] }], consumers: [] });
    expect(s).toEqual({ online: true, codec: "h264", audio: "pcm_alaw", bytes: 10 });
    expect(codecSummary(undefined).online).toBe(false);
  });
  test("record args copy video, transcode audio, segment by time", () => {
    const a = buildRecordArgs({ ffmpeg: "ffmpeg", input: "rtsp://127.0.0.1:8554/c1?video&audio", segmentSeconds: 300, outPattern: "/d/%Y-%m-%d/%H%M%S.mp4", hevc: true, audio: true });
    const s = a.join(" ");
    expect(s).toContain("-c:v copy");
    expect(s).toContain("-c:a aac");
    expect(s).toContain("-segment_time 300");
    expect(s).toContain("-reset_timestamps 1");
    expect(s).toContain("-strftime 1");
    expect(s).toContain("movflags=+faststart");
    expect(s).toContain("-tag:v hvc1");
  });
});
