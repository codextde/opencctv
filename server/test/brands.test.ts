import { describe, expect, test } from "bun:test";
import { buildSource, BRANDS, validateStreamUrl } from "../src/brands.ts";
import { maskUrl } from "../src/util.ts";
import { maskFields, unmaskFields, go2rtcSources, type CameraRecord } from "../src/cameras.ts";

describe("brand URL templates", () => {
  test("tapo main and sub stream", () => {
    const s = buildSource("tapo", undefined, { host: "192.168.1.20", username: "cam", password: "p@ss:w/rd" });
    expect(s.url).toBe("rtsp://cam:p%40ss%3Aw%2Frd@192.168.1.20:554/stream1");
    expect(s.subUrl).toBe("rtsp://cam:p%40ss%3Aw%2Frd@192.168.1.20:554/stream2");
    expect(s.ptzPort).toBe(2020);
    expect(s.kind).toBe("rtsp");
  });
  test("tapo with cloud password adds tapo:// source for two-way audio", () => {
    const s = buildSource("tapo", undefined, { host: "10.0.0.5", username: "u", password: "p", cloudPassword: "cloud" });
    expect(s.kind).toBe("tapo");
    expect(s.extra).toEqual(["tapo://cloud@10.0.0.5"]);
    expect(s.twoWayAudio).toBe(true);
  });
  test("hikvision channel 2", () => {
    const s = buildSource("hikvision", undefined, { host: "nvr.local", username: "admin", password: "x", channel: "2" });
    expect(s.url).toBe("rtsp://admin:x@nvr.local:554/Streaming/Channels/201");
    expect(s.subUrl).toBe("rtsp://admin:x@nvr.local:554/Streaming/Channels/202");
  });
  test("dahua family", () => {
    for (const b of ["dahua", "amcrest", "imou", "annke"]) {
      const s = buildSource(b, undefined, { host: "1.2.3.4", username: "a", password: "b" });
      expect(s.url).toBe("rtsp://a:b@1.2.3.4:554/cam/realmonitor?channel=1&subtype=0");
      expect(s.subUrl).toEndWith("subtype=1");
    }
  });
  test("reolink, foscam, ezviz, eufy, wyze, axis", () => {
    expect(buildSource("reolink", undefined, { host: "h", username: "a", password: "b" }).url).toBe("rtsp://a:b@h:554/h264Preview_01_main");
    expect(buildSource("foscam", undefined, { host: "h", username: "a", password: "b" }).url).toBe("rtsp://a:b@h:88/videoMain");
    expect(buildSource("ezviz", undefined, { host: "h", password: "ABCDEF" }).url).toBe("rtsp://admin:ABCDEF@h:554/h264/ch1/main/av_stream");
    expect(buildSource("eufy", undefined, { host: "h", username: "a", password: "b" }).url).toBe("rtsp://a:b@h:554/live0");
    expect(buildSource("wyze", undefined, { host: "h", username: "a", password: "b" }).url).toBe("rtsp://a:b@h:554/live");
    expect(buildSource("axis", undefined, { host: "h", username: "root", password: "b" }).url).toBe("rtsp://root:b@h:554/axis-media/media.amp");
  });
  test("unifi uses rtspx", () => {
    const s = buildSource("unifi", undefined, { host: "192.168.1.1", alias: "AbCdEf123", subAlias: "Low456" });
    expect(s.url).toBe("rtspx://192.168.1.1:7441/AbCdEf123");
    expect(s.subUrl).toBe("rtspx://192.168.1.1:7441/Low456");
  });
  test("onvif", () => {
    const s = buildSource("onvif", undefined, { host: "cam", username: "u", password: "p", port: "2020" });
    expect(s).toMatchObject({ kind: "onvif", url: "onvif://u:p@cam:2020", ptzPort: 2020 });
  });
  test("generic and push", () => {
    expect(buildSource("generic", undefined, { url: "http://cam/video.mjpg" }).kind).toBe("http");
    expect(buildSource("generic", "rtsp-push", {}).kind).toBe("rtsp-push");
    expect(() => buildSource("generic", undefined, { url: "file:///etc/passwd" })).toThrow();
    expect(() => buildSource("generic", undefined, { url: "rtsp://x/a#exec" })).toThrow();
  });
  test("rejects bad hosts", () => {
    expect(() => buildSource("hikvision", undefined, { host: "evil host; rm" })).toThrow();
    expect(() => buildSource("tapo", undefined, { host: "" })).toThrow();
  });
  test("every brand has help and fields", () => {
    for (const b of BRANDS) {
      expect(b.help.length).toBeGreaterThan(20);
      expect(b.fields.length).toBeGreaterThan(0);
    }
    expect(() => validateStreamUrl("rtsp://ok/x")).not.toThrow();
  });
});

describe("masking", () => {
  test("maskUrl hides password", () => {
    expect(maskUrl("rtsp://admin:secret@1.2.3.4/x")).toBe("rtsp://admin:***@1.2.3.4/x");
    expect(maskUrl("rtsp://1.2.3.4/x")).toBe("rtsp://1.2.3.4/x");
  });
  test("mask and unmask fields round-trip", () => {
    const prev = { host: "h", username: "u", password: "pw", url: "rtsp://u:pw@h/x" };
    const masked = maskFields("tapo", prev);
    expect(masked.password).toBe("***");
    expect(masked.url).toBe("rtsp://u:***@h/x");
    expect(unmaskFields(masked, prev)).toEqual(prev);
    expect(unmaskFields({ ...masked, password: "new" }, prev).password).toBe("new");
  });
});

describe("go2rtc sources", () => {
  const base: CameraRecord = {
    id: "c1", name: "C", brand: "tapo", kind: "rtsp", fields: {}, url: "rtsp://a/1", subUrl: "rtsp://a/2", order: 0, enabled: true,
    recordingMode: "continuous", useSubstream: false, motionEnabled: true, sensitivity: 5, notify: true, caps: {}, streamKey: "c1", createdAt: 0,
  };
  test("main + sub with ffmpeg helpers", () => {
    const s = go2rtcSources(base, true);
    expect(s[0]!.name).toBe("c1");
    expect(s[0]!.sources).toEqual(["rtsp://a/1", "ffmpeg:c1#audio=aac", "ffmpeg:c1#video=mjpeg"]);
    expect(s[1]).toEqual({ name: "c1_sub", sources: ["rtsp://a/2"] });
  });
  test("push camera has no source", () => {
    expect(go2rtcSources({ ...base, kind: "rtsp-push", streamKey: "c1_key" }, true)).toEqual([{ name: "c1_key", sources: [] }]);
  });
});
