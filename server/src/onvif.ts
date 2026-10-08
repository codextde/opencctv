import { createHash, randomBytes } from "node:crypto";

export type OnvifTarget = { host: string; port: number; username: string; password: string };
type OnvifInfo = { ptzUrl?: string; mediaUrl?: string; profile?: string; offsetMs: number; at: number };

const NS = {
  env: "http://www.w3.org/2003/05/soap-envelope",
  tds: "http://www.onvif.org/ver10/device/wsdl",
  trt: "http://www.onvif.org/ver10/media/wsdl",
  tptz: "http://www.onvif.org/ver20/ptz/wsdl",
  tt: "http://www.onvif.org/ver10/schema",
};

export function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

export function wsseHeader(username: string, password: string, now = Date.now(), nonce = randomBytes(16)): string {
  const created = new Date(now).toISOString().replace(/\.\d+Z$/, "Z");
  const digest = createHash("sha1").update(Buffer.concat([nonce, Buffer.from(created), Buffer.from(password)])).digest("base64");
  return (
    `<s:Header><Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">` +
    `<UsernameToken><Username>${xmlEscape(username)}</Username>` +
    `<Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</Password>` +
    `<Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString("base64")}</Nonce>` +
    `<Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${created}</Created>` +
    `</UsernameToken></Security></s:Header>`
  );
}

export function envelope(body: string, auth?: { username: string; password: string; offsetMs?: number }): string {
  const header = auth?.username ? wsseHeader(auth.username, auth.password, Date.now() + (auth.offsetMs ?? 0)) : "";
  return `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="${NS.env}" xmlns:tds="${NS.tds}" xmlns:trt="${NS.trt}" xmlns:tptz="${NS.tptz}" xmlns:tt="${NS.tt}">${header}<s:Body>${body}</s:Body></s:Envelope>`;
}

export function tagValues(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]!.trim());
  return out;
}

export function attrValues(xml: string, tag: string, attr: string): string[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}\\s[^>]*?${attr}="([^"]+)"`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]!);
  return out;
}

async function soap(url: string, body: string, auth?: { username: string; password: string; offsetMs?: number }, timeoutMs = 6000): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/soap+xml; charset=utf-8" },
    body: envelope(body, auth),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) {
    const reason = tagValues(text, "Text")[0] ?? tagValues(text, "Reason")[0] ?? `HTTP ${res.status}`;
    throw new Error(`ONVIF: ${reason.replace(/<[^>]+>/g, "")}`);
  }
  return text;
}

function rewriteHost(xaddr: string, t: OnvifTarget): string {
  try {
    const u = new URL(xaddr);
    u.hostname = t.host;
    if (!u.port || u.port === "80") u.port = String(t.port);
    return u.toString();
  } catch {
    return xaddr;
  }
}

export class Onvif {
  private cache = new Map<string, OnvifInfo>();

  private key(t: OnvifTarget) {
    return `${t.host}:${t.port}:${t.username}`;
  }

  async info(t: OnvifTarget, force = false): Promise<OnvifInfo> {
    const k = this.key(t);
    const hit = this.cache.get(k);
    if (hit && !force && Date.now() - hit.at < 3600_000) return hit;
    const device = `http://${t.host}:${t.port}/onvif/device_service`;
    let offsetMs = 0;
    try {
      const dt = await soap(device, "<tds:GetSystemDateAndTime/>", undefined, 4000);
      const utc = dt.match(/UTCDateTime>[\s\S]*?<\/(?:\w+:)?UTCDateTime/)?.[0] ?? "";
      const num = (tag: string) => Number(tagValues(utc, tag)[0]);
      const cam = Date.UTC(num("Year"), num("Month") - 1, num("Day"), num("Hour"), num("Minute"), num("Second"));
      if (Number.isFinite(cam)) offsetMs = cam - Date.now();
    } catch {}
    const auth = { username: t.username, password: t.password, offsetMs };
    const caps = await soap(device, `<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>`, auth);
    const section = (name: string) => caps.match(new RegExp(`<(?:\\w+:)?${name}>[\\s\\S]*?</(?:\\w+:)?${name}>`))?.[0];
    const xaddr = (s?: string) => (s ? tagValues(s, "XAddr")[0] : undefined);
    const mediaUrl = xaddr(section("Media"));
    const ptzUrl = xaddr(section("PTZ"));
    let profile: string | undefined;
    if (mediaUrl) {
      const prof = await soap(rewriteHost(mediaUrl, t), "<trt:GetProfiles/>", auth);
      profile = attrValues(prof, "Profiles", "token")[0];
    }
    const info: OnvifInfo = {
      mediaUrl: mediaUrl ? rewriteHost(mediaUrl, t) : undefined,
      ptzUrl: ptzUrl ? rewriteHost(ptzUrl, t) : undefined,
      profile,
      offsetMs,
      at: Date.now(),
    };
    this.cache.set(k, info);
    return info;
  }

  async hasPtz(t: OnvifTarget): Promise<boolean> {
    const i = await this.info(t);
    return !!(i.ptzUrl && i.profile);
  }

  private async ptz(t: OnvifTarget): Promise<{ url: string; profile: string; auth: { username: string; password: string; offsetMs: number } }> {
    const i = await this.info(t);
    if (!i.ptzUrl || !i.profile) throw new Error("Camera does not support PTZ over ONVIF");
    return { url: i.ptzUrl, profile: i.profile, auth: { username: t.username, password: t.password, offsetMs: i.offsetMs } };
  }

  async move(t: OnvifTarget, pan: number, tilt: number, zoom: number): Promise<void> {
    const p = await this.ptz(t);
    const f = (n: number) => Math.max(-1, Math.min(1, Number(n) || 0)).toFixed(2);
    const zoomPart = zoom ? `<tt:Zoom x="${f(zoom)}"/>` : "";
    await soap(
      p.url,
      `<tptz:ContinuousMove><tptz:ProfileToken>${xmlEscape(p.profile)}</tptz:ProfileToken><tptz:Velocity><tt:PanTilt x="${f(pan)}" y="${f(tilt)}"/>${zoomPart}</tptz:Velocity></tptz:ContinuousMove>`,
      p.auth,
    );
  }

  async stop(t: OnvifTarget): Promise<void> {
    const p = await this.ptz(t);
    await soap(p.url, `<tptz:Stop><tptz:ProfileToken>${xmlEscape(p.profile)}</tptz:ProfileToken><tptz:PanTilt>true</tptz:PanTilt><tptz:Zoom>true</tptz:Zoom></tptz:Stop>`, p.auth);
  }

  async gotoPreset(t: OnvifTarget, preset: string): Promise<void> {
    const p = await this.ptz(t);
    await soap(
      p.url,
      `<tptz:GotoPreset><tptz:ProfileToken>${xmlEscape(p.profile)}</tptz:ProfileToken><tptz:PresetToken>${xmlEscape(preset)}</tptz:PresetToken></tptz:GotoPreset>`,
      p.auth,
    );
  }

  async presets(t: OnvifTarget): Promise<{ token: string; name: string }[]> {
    const p = await this.ptz(t);
    const xml = await soap(p.url, `<tptz:GetPresets><tptz:ProfileToken>${xmlEscape(p.profile)}</tptz:ProfileToken></tptz:GetPresets>`, p.auth);
    const re = /<(?:\w+:)?Preset\s[^>]*token="([^"]+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?Preset>/g;
    const out: { token: string; name: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) out.push({ token: m[1]!, name: tagValues(m[2]!, "Name")[0] ?? m[1]! });
    return out;
  }
}
