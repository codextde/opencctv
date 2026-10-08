import type { DB } from "./db.ts";
import { HttpError, newId, randomCode, randomToken, sha256, toIso } from "./util.ts";

export type Role = "admin" | "viewer";
export type User = { id: string; username: string; role: Role; createdAt: string };
export type AuthUser = User & { via?: "token" | "tunnel" | "internal" };

type UserRow = { id: string; username: string; password_hash: string; role: Role; created_at: number };

const USERNAME_RE = /^[a-zA-Z0-9._@-]{1,64}$/;

export function toUser(r: UserRow): User {
  return { id: r.id, username: r.username, role: r.role, createdAt: toIso(r.created_at) };
}

export function validRole(r: unknown): Role {
  if (r === undefined || r === null || r === "") return "viewer";
  if (r !== "admin" && r !== "viewer") throw new HttpError(400, "role must be admin or viewer");
  return r;
}

export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}

  check(key: string, now = Date.now()): boolean {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 10000) this.prune(now);
    return true;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(now: number) {
    for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
  }
}

export class Auth {
  readonly limiter = new RateLimiter(10, 5 * 60_000);

  constructor(private db: DB) {}

  userCount(): number {
    return (this.db.query("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  }

  listUsers(): User[] {
    return (this.db.query("SELECT * FROM users ORDER BY created_at").all() as UserRow[]).map(toUser);
  }

  getUser(id: string): User | undefined {
    const r = this.db.query("SELECT * FROM users WHERE id = ?").get(id) as UserRow | null;
    return r ? toUser(r) : undefined;
  }

  findByName(username: string): User | undefined {
    const r = this.db.query("SELECT * FROM users WHERE username = ?").get(username) as UserRow | null;
    return r ? toUser(r) : undefined;
  }

  async createUser(username: string, password: string, role: Role): Promise<User> {
    if (!USERNAME_RE.test(username)) throw new HttpError(400, "Username may contain letters, digits and . _ @ - (max 64)");
    validatePassword(password);
    if (this.findByName(username)) throw new HttpError(409, "Username already exists");
    const id = newId();
    const hash = await Bun.password.hash(password, { algorithm: "argon2id" });
    this.db.query("INSERT INTO users(id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)").run(id, username, hash, role, Date.now());
    return this.getUser(id)!;
  }

  async updateUser(id: string, patch: { username?: string; password?: string; role?: Role }): Promise<User> {
    const user = this.getUser(id);
    if (!user) throw new HttpError(404, "User not found");
    if (patch.username !== undefined && patch.username !== user.username) {
      if (!USERNAME_RE.test(patch.username)) throw new HttpError(400, "Invalid username");
      if (this.findByName(patch.username)) throw new HttpError(409, "Username already exists");
      this.db.query("UPDATE users SET username = ? WHERE id = ?").run(patch.username, id);
    }
    if (patch.role !== undefined && patch.role !== user.role) {
      if (user.role === "admin" && this.adminCount() <= 1) throw new HttpError(400, "Cannot demote the last admin");
      this.db.query("UPDATE users SET role = ? WHERE id = ?").run(patch.role, id);
    }
    if (patch.password) {
      validatePassword(patch.password);
      const hash = await Bun.password.hash(patch.password, { algorithm: "argon2id" });
      this.db.query("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, id);
      this.db.query("DELETE FROM tokens WHERE user_id = ?").run(id);
    }
    return this.getUser(id)!;
  }

  deleteUser(id: string): void {
    const user = this.getUser(id);
    if (!user) throw new HttpError(404, "User not found");
    if (user.role === "admin" && this.adminCount() <= 1) throw new HttpError(400, "Cannot delete the last admin");
    this.db.query("DELETE FROM users WHERE id = ?").run(id);
  }

  adminCount(): number {
    return (this.db.query("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number }).n;
  }

  async verifyPassword(username: string, password: string): Promise<User | undefined> {
    const r = this.db.query("SELECT * FROM users WHERE username = ?").get(username) as UserRow | null;
    if (!r) {
      await Bun.password.verify(password, DUMMY_HASH).catch(() => false);
      return undefined;
    }
    const ok = await Bun.password.verify(password, r.password_hash).catch(() => false);
    return ok ? toUser(r) : undefined;
  }

  issueToken(userId: string, deviceName?: string): string {
    const token = randomToken();
    const now = Date.now();
    this.db
      .query("INSERT INTO tokens(hash, user_id, device_name, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)")
      .run(sha256(token), userId, deviceName?.slice(0, 100) ?? null, now, now);
    return token;
  }

  private lastTouch = new Map<string, number>();

  userForToken(token: string | null | undefined): User | undefined {
    if (!token || token.length < 20 || token.length > 200) return undefined;
    const hash = sha256(token);
    const r = this.db
      .query("SELECT u.* FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.hash = ?")
      .get(hash) as UserRow | null;
    if (!r) return undefined;
    const now = Date.now();
    if (now - (this.lastTouch.get(hash) ?? 0) > 60_000) {
      this.lastTouch.set(hash, now);
      this.db.query("UPDATE tokens SET last_used_at = ? WHERE hash = ?").run(now, hash);
    }
    return toUser(r);
  }

  revokeToken(token: string): void {
    this.db.query("DELETE FROM tokens WHERE hash = ?").run(sha256(token));
  }

  createPairingCode(createdBy: string, role: Role, ttlMs = 10 * 60_000): { code: string; expiresAt: number } {
    const code = randomCode(8);
    const expiresAt = Date.now() + ttlMs;
    this.db.query("DELETE FROM pairing_codes WHERE expires_at < ?").run(Date.now());
    this.db.query("INSERT INTO pairing_codes(code_hash, role, created_by, expires_at) VALUES (?, ?, ?, ?)").run(sha256(normalizeCode(code)), role, createdBy, expiresAt);
    return { code, expiresAt };
  }

  async redeemPairingCode(code: string, deviceName?: string): Promise<{ token: string; user: User }> {
    const hash = sha256(normalizeCode(code));
    const row = this.db.query("SELECT * FROM pairing_codes WHERE code_hash = ?").get(hash) as
      | { role: Role; created_by: string; expires_at: number }
      | null;
    this.db.query("DELETE FROM pairing_codes WHERE code_hash = ?").run(hash);
    if (!row || row.expires_at < Date.now()) throw new HttpError(401, "Invalid or expired pairing code");
    const creator = this.getUser(row.created_by);
    let user: User;
    if (row.role === "admin" && creator?.role === "admin") user = creator;
    else {
      const name = `device-${randomCode(6).toLowerCase()}`;
      user = await this.createUser(name, randomToken(24), "viewer");
    }
    return { token: this.issueToken(user.id, deviceName ?? "Paired device"), user };
  }

  async resetPassword(username: string, password: string): Promise<void> {
    const user = this.findByName(username);
    if (!user) throw new Error(`User ${username} not found`);
    await this.updateUser(user.id, { password });
  }
}

function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function validatePassword(pw: string): void {
  if (typeof pw !== "string" || pw.length < 4) throw new HttpError(400, "Password must be at least 4 characters");
  if (pw.length > 256) throw new HttpError(400, "Password is too long");
}

const DUMMY_HASH = "$argon2id$v=19$m=65536,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$7Jc6Lq2Q2cSx2wqkQh6s0uQ4Yy9lH2Ztq9rM8lYV3uE";

export function bearerToken(req: Request, url: URL): string | undefined {
  const h = req.headers.get("authorization");
  if (h?.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return url.searchParams.get("token") ?? undefined;
}
