import { describe, expect, test } from "bun:test";
import { selectLocalDeletions } from "../src/retention.ts";
import { remoteBase, rcloneSection, validateConfig } from "../src/storage/types.ts";
import { remoteRecordingPath, maskConfig, slug } from "../src/storage/index.ts";

const DAY = 86400_000;
const now = Date.UTC(2026, 9, 8, 12);
const rec = (id: string, ageDays: number, size: number) => ({ id, start: now - ageDays * DAY, end: now - ageDays * DAY + 300_000, size });

describe("local retention selection", () => {
  test("by age", () => {
    const ids = selectLocalDeletions([rec("a", 10, 1), rec("b", 3, 1), rec("c", 0.5, 1)], { now, localDays: 7, maxBytes: 0 });
    expect(ids).toEqual(["a"]);
  });
  test("by size, oldest first", () => {
    const ids = selectLocalDeletions([rec("new", 1, 400), rec("old", 3, 400), rec("mid", 2, 400)], { now, localDays: 0, maxBytes: 500 });
    expect(ids.sort()).toEqual(["mid", "old"]);
  });
  test("combined, nothing when unlimited", () => {
    expect(selectLocalDeletions([rec("a", 100, 1e12)], { now, localDays: 0, maxBytes: 0 })).toEqual([]);
    const ids = selectLocalDeletions([rec("x", 9, 100), rec("y", 2, 600), rec("z", 1, 600)], { now, localDays: 7, maxBytes: 700 });
    expect(ids.sort()).toEqual(["x", "y"]);
  });
});

describe("storage targets", () => {
  test("remote base per type never escapes", () => {
    expect(remoteBase("s3", { bucket: "b" }, "OpenCCTV/../x")).toBe("b/OpenCCTV/x");
    expect(remoteBase("smb", { share: "cctv" }, "/a/b/")).toBe("cctv/a/b");
    expect(remoteBase("local", { root: "/mnt/nas/" }, "OpenCCTV")).toBe("/mnt/nas/OpenCCTV");
    expect(remoteBase("gdrive", {}, "")).toBe("");
  });
  test("rclone sections obscure passwords and use drive.file", () => {
    const ftp = rcloneSection("ftp", { host: "h", user: "u", password: "pw", tls: "explicit" }, (s) => `OBS(${s})`);
    expect(ftp).toMatchObject({ type: "ftp", pass: "OBS(pw)", explicit_tls: "true" });
    const drive = rcloneSection("gdrive", { token: "{}", clientId: "id" }, (s) => s);
    expect(drive).toMatchObject({ type: "drive", scope: "drive.file", client_id: "id" });
    const sftp = rcloneSection("sftp", { host: "h", user: "u", privateKey: "-----BEGIN\nabc\n-----END" }, (s) => s);
    expect(sftp.key_pem).toBe("-----BEGIN\\nabc\\n-----END");
  });
  test("validation", () => {
    expect(() => validateConfig("local", { root: "relative/path" })).toThrow();
    expect(() => validateConfig("gdrive", { token: "nope" })).toThrow();
    expect(() => validateConfig("ftp", { host: "h", user: "u", password: "p\nq", tls: "none" })).toThrow();
    expect(() => validateConfig("s3", { provider: "AWS", bucket: "b", accessKeyId: "a", secretAccessKey: "s" })).not.toThrow();
  });
  test("masking and remote paths", () => {
    expect(maskConfig("s3", { bucket: "b", secretAccessKey: "s" })).toEqual({ bucket: "b", secretAccessKey: "***" });
    expect(remoteRecordingPath("Front Door", "abc", Date.UTC(2026, 0, 2, 3, 4, 5))).toBe("front-door_abc/2026-01-02/030405.mp4");
    expect(slug("Garten / Süd")).toBe("garten-sud");
  });
});
