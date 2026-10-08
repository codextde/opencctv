import { HttpError, newId, randomToken } from "../util.ts";
import { logger, errMsg } from "../log.ts";

const log = logger("gdrive");
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

type Flow = {
  id: string;
  mode: "device" | "browser";
  status: "pending" | "done" | "expired" | "error";
  clientId: string;
  clientSecret: string;
  name: string;
  path: string;
  retentionDays: number;
  expiresAt: number;
  deviceCode?: string;
  interval?: number;
  redirectUri?: string;
  state?: string;
  targetId?: string;
  error?: string;
};

export type GoogleClients = { clientId?: string; clientSecret?: string; webClientId?: string; webClientSecret?: string };

export function rcloneToken(t: { access_token: string; refresh_token?: string; expires_in?: number; token_type?: string }): string {
  return JSON.stringify({
    access_token: t.access_token,
    token_type: t.token_type ?? "Bearer",
    refresh_token: t.refresh_token ?? "",
    expiry: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
  });
}

export class GDriveFlows {
  private flows = new Map<string, Flow>();

  constructor(
    private clients: GoogleClients,
    private createTarget: (input: { name: string; path: string; retentionDays: number; config: Record<string, string> }) => Promise<{ id: string }>,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  capabilities() {
    return { deviceFlow: !!(this.clients.clientId && this.clients.clientSecret), browserFlow: true, defaultBrowserClient: !!this.clients.webClientId };
  }

  async start(body: Record<string, unknown>, baseUrl: string) {
    this.gc();
    const name = String(body.name || "Google Drive").slice(0, 80);
    const path = String(body.path || "OpenCCTV").slice(0, 200);
    const retentionDays = Math.max(0, Math.round(Number(body.retentionDays ?? 30)) || 0);
    const wantBrowser = body.mode === "browser" || !!body.clientId || !this.capabilities().deviceFlow;
    if (!wantBrowser) {
      const clientId = this.clients.clientId!;
      const clientSecret = this.clients.clientSecret!;
      const res = await this.fetchImpl("https://oauth2.googleapis.com/device/code", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, scope: SCOPE }),
      });
      const j = (await res.json()) as { device_code?: string; user_code?: string; verification_url?: string; expires_in?: number; interval?: number; error_description?: string; error?: string };
      if (!res.ok || !j.device_code) throw new HttpError(502, `Google: ${j.error_description ?? j.error ?? res.status}`);
      const flow: Flow = {
        id: newId(12),
        mode: "device",
        status: "pending",
        clientId,
        clientSecret,
        name,
        path,
        retentionDays,
        expiresAt: Date.now() + (j.expires_in ?? 1800) * 1000,
        deviceCode: j.device_code,
        interval: Math.max(5, j.interval ?? 5),
      };
      this.flows.set(flow.id, flow);
      void this.pollDevice(flow);
      return { flowId: flow.id, verificationUrl: j.verification_url ?? "https://www.google.com/device", userCode: j.user_code, expiresAt: new Date(flow.expiresAt).toISOString() };
    }
    const clientId = String(body.clientId || this.clients.webClientId || "");
    const clientSecret = String(body.clientSecret || (body.clientId ? "" : this.clients.webClientSecret) || "");
    if (!clientId || !clientSecret) throw new HttpError(400, "A Google OAuth client id and secret are required for the browser flow");
    const flow: Flow = {
      id: newId(12),
      mode: "browser",
      status: "pending",
      clientId,
      clientSecret,
      name,
      path,
      retentionDays,
      expiresAt: Date.now() + 15 * 60_000,
      redirectUri: `${baseUrl}/api/storage/gdrive/callback`,
      state: `${newId(12)}.${randomToken(16)}`,
    };
    flow.id = flow.state!.split(".")[0]!;
    this.flows.set(flow.id, flow);
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: flow.redirectUri!,
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
      prompt: "consent",
      state: flow.state!,
    }).toString();
    return { flowId: flow.id, authUrl: authUrl.toString(), redirectUri: flow.redirectUri, expiresAt: new Date(flow.expiresAt).toISOString() };
  }

  status(flowId: string): Flow | undefined {
    const f = this.flows.get(flowId);
    if (f && f.status === "pending" && Date.now() > f.expiresAt) f.status = "expired";
    return f;
  }

  async callback(state: string, code: string | null, error: string | null): Promise<{ ok: boolean; message: string }> {
    const id = state.split(".")[0] ?? "";
    const flow = this.flows.get(id);
    if (!flow || flow.mode !== "browser" || flow.state !== state) return { ok: false, message: "Unknown or expired authorization request." };
    if (error || !code) {
      flow.status = "error";
      flow.error = error ?? "No authorization code";
      return { ok: false, message: `Google returned: ${flow.error}` };
    }
    try {
      const res = await this.fetchImpl(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: flow.clientId,
          client_secret: flow.clientSecret,
          redirect_uri: flow.redirectUri!,
          grant_type: "authorization_code",
        }),
      });
      const j = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string; error?: string };
      if (!res.ok || !j.access_token) throw new Error(j.error_description ?? j.error ?? `HTTP ${res.status}`);
      await this.finish(flow, j as { access_token: string });
      return { ok: true, message: "Google Drive is connected. You can close this window." };
    } catch (e) {
      flow.status = "error";
      flow.error = errMsg(e);
      return { ok: false, message: `Could not connect Google Drive: ${flow.error}` };
    }
  }

  private async finish(flow: Flow, tok: { access_token: string; refresh_token?: string; expires_in?: number }) {
    const target = await this.createTarget({
      name: flow.name,
      path: flow.path,
      retentionDays: flow.retentionDays,
      config: { token: rcloneToken(tok), clientId: flow.clientId, clientSecret: flow.clientSecret },
    });
    flow.status = "done";
    flow.targetId = target.id;
    log.info(`Google Drive target ${flow.name} connected`);
  }

  private async pollDevice(flow: Flow) {
    while (flow.status === "pending") {
      await Bun.sleep((flow.interval ?? 5) * 1000);
      if (Date.now() > flow.expiresAt) {
        flow.status = "expired";
        return;
      }
      try {
        const res = await this.fetchImpl(TOKEN_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: flow.clientId,
            client_secret: flow.clientSecret,
            device_code: flow.deviceCode!,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
        });
        const j = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
        if (j.access_token) {
          await this.finish(flow, j as { access_token: string });
          return;
        }
        if (j.error === "authorization_pending") continue;
        if (j.error === "slow_down") {
          flow.interval = (flow.interval ?? 5) + 5;
          continue;
        }
        flow.status = j.error === "expired_token" ? "expired" : "error";
        flow.error = j.error_description ?? j.error;
      } catch (e) {
        log.warn(`device flow poll: ${errMsg(e)}`);
      }
    }
  }

  private gc() {
    const now = Date.now();
    for (const [id, f] of this.flows) if (now - f.expiresAt > 60 * 60_000) this.flows.delete(id);
  }
}
