import type { Server } from "bun";
import type { App, HandleMeta } from "../app.ts";
import type { AuthUser, Role } from "../auth.ts";

export type Access = "public" | "user" | "admin";

export type Ctx = {
  req: Request;
  url: URL;
  params: Record<string, string>;
  user?: AuthUser;
  app: App;
  base: string;
  meta: HandleMeta;
  server?: Server<unknown>;
  ip: string;
  token?: string;
};

export type Handler = (ctx: Ctx) => Response | undefined | Promise<Response | undefined>;

type Route = { method: string; parts: string[]; access: Access; handler: Handler };

export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, access: Access, handler: Handler): this {
    this.routes.push({ method, parts: path.split("/").filter(Boolean), access, handler });
    return this;
  }

  get(p: string, a: Access, h: Handler) {
    return this.add("GET", p, a, h);
  }
  post(p: string, a: Access, h: Handler) {
    return this.add("POST", p, a, h);
  }
  patch(p: string, a: Access, h: Handler) {
    return this.add("PATCH", p, a, h);
  }
  delete(p: string, a: Access, h: Handler) {
    return this.add("DELETE", p, a, h);
  }

  match(method: string, path: string): { route?: Route; params: Record<string, string>; methodMismatch: boolean } {
    const segs = path.split("/").filter(Boolean).map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
    let methodMismatch = false;
    for (const r of this.routes) {
      const params = matchParts(r.parts, segs);
      if (!params) continue;
      if (r.method === method || (method === "HEAD" && r.method === "GET")) return { route: r, params, methodMismatch: false };
      methodMismatch = true;
    }
    return { params: {}, methodMismatch };
  }
}

export function matchParts(pattern: string[], segs: string[]): Record<string, string> | undefined {
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i]!;
    if (p === "*") {
      params["*"] = segs.slice(i).join("/");
      return params;
    }
    const s = segs[i];
    if (s === undefined) return undefined;
    if (p.startsWith(":")) params[p.slice(1)] = s;
    else if (p !== s) return undefined;
  }
  return segs.length === pattern.length ? params : undefined;
}

export function roleAllows(role: Role | undefined, access: Access): boolean {
  if (access === "public") return true;
  if (!role) return false;
  return access === "user" || role === "admin";
}
