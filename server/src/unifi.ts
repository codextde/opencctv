import { HttpError } from "./util.ts";

type Channel = { id: number; name?: string; enabled?: boolean; isRtspEnabled?: boolean; rtspAlias?: string | null; width?: number; height?: number };
type ProtectCamera = { id: string; name: string; type?: string; marketName?: string; channels: Channel[]; state?: string };

export type UnifiCameraInfo = { id: string; name: string; model: string; alias?: string; subAlias?: string };

const insecure = { tls: { rejectUnauthorized: false } } as Record<string, unknown>;

function baseUrl(host: string): string {
  const h = host.trim().replace(/\/+$/, "");
  if (!/^[a-zA-Z0-9.\-:\[\]/]+$/.test(h.replace(/^https?:\/\//, ""))) throw new HttpError(400, "Invalid host");
  return h.startsWith("http") ? h : `https://${h}`;
}

export function hostOnly(host: string): string {
  return new URL(baseUrl(host)).hostname;
}

export class UnifiClient {
  private cookie = "";
  private csrf = "";
  private base: string;

  constructor(host: string) {
    this.base = baseUrl(host);
  }

  private async req(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (this.cookie) headers.set("cookie", this.cookie);
    if (this.csrf) headers.set("x-csrf-token", this.csrf);
    const res = await fetch(`${this.base}${path}`, { ...init, headers, signal: AbortSignal.timeout(15_000), ...insecure } as RequestInit);
    const updated = res.headers.get("x-updated-csrf-token") ?? res.headers.get("x-csrf-token");
    if (updated) this.csrf = updated;
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const tok = setCookie.match(/TOKEN=[^;]+/);
      if (tok) this.cookie = tok[0];
    }
    return res;
  }

  async login(username: string, password: string): Promise<void> {
    let res: Response;
    try {
      res = await this.req("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password, rememberMe: false, token: "" }),
      });
    } catch (e) {
      throw new HttpError(502, `Cannot reach UniFi console: ${e instanceof Error ? e.message : e}`);
    }
    if (res.status === 401 || res.status === 403) throw new HttpError(401, "UniFi login failed. Use a local Protect account (not a cloud account with 2FA).");
    if (!res.ok) throw new HttpError(502, `UniFi login failed (${res.status})`);
  }

  async cameras(): Promise<ProtectCamera[]> {
    const res = await this.req("/proxy/protect/api/bootstrap");
    if (!res.ok) throw new HttpError(502, `Protect bootstrap failed (${res.status})`);
    const j = (await res.json()) as { cameras?: ProtectCamera[] };
    return j.cameras ?? [];
  }

  async enableRtsp(cam: ProtectCamera, channelIds: number[]): Promise<ProtectCamera> {
    const channels = cam.channels.map((c) => (channelIds.includes(c.id) ? { ...c, isRtspEnabled: true } : c));
    const res = await this.req(`/proxy/protect/api/cameras/${encodeURIComponent(cam.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channels }),
    });
    if (!res.ok) throw new HttpError(502, `Could not enable RTSP on ${cam.name} (${res.status})`);
    return (await res.json()) as ProtectCamera;
  }
}

export async function importUnifi(host: string, username: string, password: string, onlyIds?: string[]): Promise<UnifiCameraInfo[]> {
  const client = new UnifiClient(host);
  await client.login(username, password);
  const cams = await client.cameras();
  const out: UnifiCameraInfo[] = [];
  for (let cam of cams) {
    if (onlyIds?.length && !onlyIds.includes(cam.id)) continue;
    const main = cam.channels.find((c) => c.id === 0) ?? cam.channels[0];
    const low = cam.channels.find((c) => c.id === 2) ?? cam.channels.find((c) => c.id === 1);
    const need = [main, low].filter((c): c is Channel => !!c && !c.isRtspEnabled).map((c) => c.id);
    if (need.length) {
      try {
        cam = await client.enableRtsp(cam, need);
      } catch {}
    }
    const m = cam.channels.find((c) => c.id === main?.id);
    const l = cam.channels.find((c) => c.id === low?.id);
    out.push({
      id: cam.id,
      name: cam.name,
      model: cam.marketName ?? cam.type ?? "UniFi camera",
      alias: m?.rtspAlias ?? undefined,
      subAlias: l?.rtspAlias ?? undefined,
    });
  }
  return out;
}
