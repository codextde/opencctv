import { statSync } from "node:fs";
import { resolve, sep } from "node:path";

export function parseRange(header: string | null, size: number): { start: number; end: number } | "invalid" | undefined {
  if (!header) return undefined;
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return "invalid";
  return { start, end };
}

export function safeJoin(root: string, rel: string): string | undefined {
  const base = resolve(root);
  const full = resolve(base, rel);
  if (full !== base && !full.startsWith(base + sep)) return undefined;
  return full;
}

export function serveFile(path: string, req: Request, contentType: string, cache = "private, max-age=3600"): Response {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return new Response(JSON.stringify({ error: "File not found" }), { status: 404, headers: { "content-type": "application/json" } });
  }
  const file = Bun.file(path);
  const range = parseRange(req.headers.get("range"), size);
  const headers = new Headers({ "content-type": contentType, "accept-ranges": "bytes", "cache-control": cache });
  if (range === "invalid") {
    headers.set("content-range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  if (range) {
    headers.set("content-range", `bytes ${range.start}-${range.end}/${size}`);
    headers.set("content-length", String(range.end - range.start + 1));
    return new Response(req.method === "HEAD" ? null : file.slice(range.start, range.end + 1), { status: 206, headers });
  }
  headers.set("content-length", String(size));
  return new Response(req.method === "HEAD" ? null : file, { status: 200, headers });
}

export function rewritePlaylist(text: string, token: string | undefined): string {
  if (!token) return text;
  const add = (u: string) => (/^[a-z]+:\/\//i.test(u) || u.startsWith("/") ? u : `${u}${u.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`);
  return text
    .split("\n")
    .map((line) => {
      const l = line.trim();
      if (!l) return line;
      if (l.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_m, u: string) => `URI="${add(u)}"`);
      return add(l);
    })
    .join("\n");
}
