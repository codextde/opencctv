import { describe, expect, test } from "bun:test";
import { deflateRawSync } from "node:zlib";
import { parseDemoUrls } from "../src/config.ts";
import { titleCase, demoSource, demoId } from "../src/demo.ts";
import { unzipEntries } from "../src/deps.ts";
import { dayBounds } from "../src/recordings.ts";
import { wsseHeader, tagValues, attrValues } from "../src/onvif.ts";
import { parseProbeMatch, scopeValue, guessBrand } from "../src/discovery.ts";
import { rcloneToken } from "../src/storage/gdrive.ts";
import { redact } from "../src/log.ts";
import { matchParts } from "../src/http/router.ts";
import { createHash } from "node:crypto";

describe("demo", () => {
  test("OPENCCTV_DEMO_URLS parsing", () => {
    expect(parseDemoUrls("Front Door|https://x/a.mp4, https://x/b.mp4 ,bad|ftp://x")).toEqual([
      { name: "Front Door", url: "https://x/a.mp4" },
      { name: "Camera 2", url: "https://x/b.mp4" },
    ]);
    expect(parseDemoUrls(undefined)).toEqual([]);
  });
  test("names and sources", () => {
    expect(titleCase("parking-deck.mp4")).toBe("Parking Deck");
    expect(demoId("Shop Entrance")).toBe("demo-shop-entrance");
    const s = demoSource("/usr/bin/ffmpeg", { name: "A", file: "/m/a b.mp4" });
    expect(s).toContain('-stream_loop -1 -i "/m/a b.mp4"');
    expect(s).toContain("-c:v copy");
    expect(s).toEndWith("{output}");
  });
});

describe("zip extraction", () => {
  test("stored and deflated entries", () => {
    const enc = new TextEncoder();
    const files = [
      { name: "dir/", data: new Uint8Array(0), method: 0 },
      { name: "dir/rclone", data: enc.encode("binary-content-".repeat(100)), method: 8 },
    ];
    const locals: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    for (const f of files) {
      const comp = f.method === 8 ? new Uint8Array(deflateRawSync(f.data)) : f.data;
      const name = enc.encode(f.name);
      const lh = new Uint8Array(30 + name.length);
      const lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(8, f.method, true);
      lv.setUint32(18, comp.length, true);
      lv.setUint32(22, f.data.length, true);
      lv.setUint16(26, name.length, true);
      lh.set(name, 30);
      const ch = new Uint8Array(46 + name.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(10, f.method, true);
      cv.setUint32(20, comp.length, true);
      cv.setUint32(24, f.data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      ch.set(name, 46);
      locals.push(lh, comp);
      central.push(ch);
      offset += lh.length + comp.length;
    }
    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    const zip = Buffer.concat([...locals, ...central, eocd]);
    const entries = unzipEntries(new Uint8Array(zip));
    expect(entries.map((e) => e.name)).toEqual(["dir/", "dir/rclone"]);
    expect(new TextDecoder().decode(entries[1]!.data())).toBe("binary-content-".repeat(100));
  });
});

describe("timeline days", () => {
  test("day bounds respect time zones and DST", () => {
    expect(dayBounds("2026-10-08", "UTC")).toEqual({ from: Date.UTC(2026, 9, 8), to: Date.UTC(2026, 9, 9) });
    const b = dayBounds("2026-10-08", "Europe/Berlin");
    expect(new Date(b.from).toISOString()).toBe("2026-10-07T22:00:00.000Z");
    expect(new Date(b.to).toISOString()).toBe("2026-10-08T22:00:00.000Z");
    const dst = dayBounds("2026-10-25", "Europe/Berlin");
    expect((dst.to - dst.from) / 3600_000).toBe(25);
    expect(() => dayBounds("08.10.2026", "UTC")).toThrow();
  });
});

describe("onvif and discovery", () => {
  test("WS-Security password digest", () => {
    const nonce = Buffer.from("0123456789abcdef");
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    const h = wsseHeader("admin", "pw", now, nonce);
    const expected = createHash("sha1").update(Buffer.concat([nonce, Buffer.from("2026-01-01T00:00:00Z"), Buffer.from("pw")])).digest("base64");
    expect(h).toContain(`#PasswordDigest">${expected}</Password>`);
    expect(h).toContain("<Created");
  });
  test("xml helpers", () => {
    const xml = '<tds:XAddr>http://1.2.3.4/onvif/ptz</tds:XAddr><trt:Profiles token="Profile_1" fixed="true"><tt:Name>main</tt:Name></trt:Profiles>';
    expect(tagValues(xml, "XAddr")).toEqual(["http://1.2.3.4/onvif/ptz"]);
    expect(attrValues(xml, "Profiles", "token")).toEqual(["Profile_1"]);
  });
  test("probe match parsing and brand guessing", () => {
    const xml = "<d:XAddrs>http://192.168.1.9:2020/onvif/device_service</d:XAddrs><d:Scopes>onvif://www.onvif.org/name/TP-IPC onvif://www.onvif.org/hardware/C200</d:Scopes>";
    const p = parseProbeMatch(xml);
    expect(p.xaddrs[0]).toContain(":2020");
    expect(scopeValue(p.scopes, "hardware")).toBe("C200");
    expect(guessBrand("TP-IPC C200 tp-link")).toBe("tapo");
    expect(guessBrand("Server: DNVRS-Webs")).toBe("hikvision");
    expect(guessBrand("nothing")).toBeUndefined();
  });
});

describe("misc", () => {
  test("rclone token format", () => {
    const t = JSON.parse(rcloneToken({ access_token: "a", refresh_token: "r", expires_in: 3600 }));
    expect(t).toMatchObject({ access_token: "a", refresh_token: "r", token_type: "Bearer" });
    expect(Date.parse(t.expiry)).toBeGreaterThan(Date.now());
  });
  test("log redaction", () => {
    expect(redact("rtsp://admin:hunter2@1.2.3.4/x")).toBe("rtsp://admin:***@1.2.3.4/x");
    expect(redact("GET /a?token=abc&x=1")).toBe("GET /a?token=***&x=1");
    expect(redact('{"password":"pw"}')).toBe('{"password":"***"}');
  });
  test("router pattern matching", () => {
    expect(matchParts(["api", "cameras", ":id"], ["api", "cameras", "x"])).toEqual({ id: "x" });
    expect(matchParts(["api", "cameras", ":id"], ["api", "cameras"])).toBeUndefined();
    expect(matchParts(["s", ":site", "*"], ["s", "a", "api", "x"])).toEqual({ site: "a", "*": "api/x" });
  });
});
