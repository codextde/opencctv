import { describe, expect, test } from "bun:test";
import { openDb } from "../src/db.ts";
import { Auth, RateLimiter } from "../src/auth.ts";
import { SettingsStore } from "../src/settings.ts";
import { Push } from "../src/push.ts";
import { deepMerge, safeEqual } from "../src/util.ts";

const mk = () => new Auth(openDb(":memory:"));

describe("auth", () => {
  test("users, passwords and tokens", async () => {
    const a = mk();
    expect(a.userCount()).toBe(0);
    const u = await a.createUser("admin", "secret1", "admin");
    expect(await a.verifyPassword("admin", "secret1")).toMatchObject({ id: u.id, role: "admin" });
    expect(await a.verifyPassword("ADMIN", "secret1")).toBeDefined();
    expect(await a.verifyPassword("admin", "wrong")).toBeUndefined();
    expect(await a.verifyPassword("nobody", "x")).toBeUndefined();
    const t = a.issueToken(u.id, "phone");
    expect(a.userForToken(t)?.id).toBe(u.id);
    expect(a.userForToken(t + "x")).toBeUndefined();
    a.revokeToken(t);
    expect(a.userForToken(t)).toBeUndefined();
    await expect(a.createUser("admin", "another", "viewer")).rejects.toThrow();
    await expect(a.createUser("bad name", "another", "viewer")).rejects.toThrow();
  });
  test("token is stored hashed", async () => {
    const db = openDb(":memory:");
    const a = new Auth(db);
    const u = await a.createUser("x", "secret1", "viewer");
    const t = a.issueToken(u.id);
    const row = db.query("SELECT hash FROM tokens").get() as { hash: string };
    expect(row.hash).not.toBe(t);
    expect(row.hash).toHaveLength(64);
  });
  test("password change revokes tokens, last admin protected", async () => {
    const a = mk();
    const u = await a.createUser("admin", "secret1", "admin");
    const t = a.issueToken(u.id);
    await a.updateUser(u.id, { password: "secret2" });
    expect(a.userForToken(t)).toBeUndefined();
    await expect(a.updateUser(u.id, { role: "viewer" })).rejects.toThrow();
    expect(() => a.deleteUser(u.id)).toThrow();
  });
  test("pairing codes are single use", async () => {
    const a = mk();
    const admin = await a.createUser("admin", "secret1", "admin");
    const { code } = a.createPairingCode(admin.id, "viewer");
    const r = await a.redeemPairingCode(code.toLowerCase(), "iPhone");
    expect(r.user.role).toBe("viewer");
    expect(a.userForToken(r.token)).toBeDefined();
    await expect(a.redeemPairingCode(code)).rejects.toThrow();
    const adm = a.createPairingCode(admin.id, "admin");
    expect((await a.redeemPairingCode(adm.code)).user.id).toBe(admin.id);
    const expired = a.createPairingCode(admin.id, "viewer", -1);
    await expect(a.redeemPairingCode(expired.code)).rejects.toThrow();
  });
  test("rate limiter", () => {
    const l = new RateLimiter(3, 1000);
    expect([l.check("k", 0), l.check("k", 1), l.check("k", 2), l.check("k", 3)]).toEqual([true, true, true, false]);
    expect(l.check("k", 1500)).toBe(true);
    expect(l.check("other", 3)).toBe(true);
  });
  test("constant-time compare", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("settings and push", () => {
  test("deep patch with sanitising", () => {
    const s = new SettingsStore(openDb(":memory:"));
    const out = s.patch({ recording: { segmentSeconds: 2 }, retention: { localDays: 7 }, gateway: { url: "x" } });
    expect(out.recording.segmentSeconds).toBe(10);
    expect(out.recording.preMotionSec).toBe(5);
    expect(out.retention.localDays).toBe(7);
    expect((out as Record<string, unknown>).gateway).toBeUndefined();
    expect(deepMerge({ a: { b: 1, c: 2 } }, { a: { b: 3 } })).toEqual({ a: { b: 3, c: 2 } });
  });
  test("expo push respects cooldown and camera filter", async () => {
    const sent: unknown[] = [];
    const p = new Push(openDb(":memory:"), async (body) => {
      sent.push(body);
      return { data: (body as unknown[]).map(() => ({ status: "ok" })) };
    });
    p.register("u1", "ExponentPushToken[abc]", "ios");
    p.register("u2", "ExponentPushToken[def]", "android", ["other"]);
    expect(() => p.register("u1", "not-a-token")).toThrow();
    const n = await p.notifyMotion({ cameraId: "cam", cameraName: "Front", eventId: "e", serverName: "S", cooldownSec: 60, at: Date.now() });
    expect(n).toBe(1);
    expect((sent[0] as { to: string }[])[0]!.to).toBe("ExponentPushToken[abc]");
    expect(await p.notifyMotion({ cameraId: "cam", cameraName: "Front", eventId: "e2", serverName: "S", cooldownSec: 60, at: Date.now() })).toBe(0);
  });
});
