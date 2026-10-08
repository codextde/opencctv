import { createSocket } from "node:dgram";
import { Socket } from "node:net";
import { networkInterfaces } from "node:os";
import { randomUUID } from "node:crypto";
import { tagValues } from "./onvif.ts";

export type Candidate = {
  host: string;
  port: number;
  brand?: string;
  name?: string;
  model?: string;
  onvif: boolean;
  rtsp: boolean;
  onvifPort?: number;
  openPorts: number[];
  alreadyAdded: boolean;
};

const PROBE = (id: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl"><e:Header><w:MessageID>uuid:${id}</w:MessageID><w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To><w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header><e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body></e:Envelope>`;

export function parseProbeMatch(xml: string): { xaddrs: string[]; scopes: string[] } {
  const xaddrs = (tagValues(xml, "XAddrs")[0] ?? "").split(/\s+/).filter(Boolean);
  const scopes = (tagValues(xml, "Scopes")[0] ?? "").split(/\s+/).filter(Boolean);
  return { xaddrs, scopes };
}

export function scopeValue(scopes: string[], key: string): string | undefined {
  const s = scopes.find((x) => x.toLowerCase().includes(`/${key}/`));
  if (!s) return undefined;
  try {
    return decodeURIComponent(s.split(`/${key}/`)[1] ?? "").replace(/_/g, " ") || undefined;
  } catch {
    return s.split(`/${key}/`)[1];
  }
}

export function guessBrand(text: string): string | undefined {
  const t = text.toLowerCase();
  const map: [RegExp, string][] = [
    [/tapo|tp-link/, "tapo"],
    [/hikvision|hikv|dnvrs-webs|app-webs/, "hikvision"],
    [/reolink/, "reolink"],
    [/amcrest/, "amcrest"],
    [/dahua/, "dahua"],
    [/imou/, "imou"],
    [/axis/, "axis"],
    [/foscam/, "foscam"],
    [/ezviz/, "ezviz"],
    [/annke/, "annke"],
    [/ubnt|ubiquiti|unifi/, "unifi"],
    [/eufy|anker/, "eufy"],
    [/wyze/, "wyze"],
  ];
  return map.find(([re]) => re.test(t))?.[1];
}

export function wsDiscovery(timeoutMs = 3000): Promise<{ host: string; port: number; name?: string; model?: string; brand?: string }[]> {
  return new Promise((resolve) => {
    const found = new Map<string, { host: string; port: number; name?: string; model?: string; brand?: string }>();
    let sock: ReturnType<typeof createSocket>;
    try {
      sock = createSocket({ type: "udp4", reuseAddr: true });
    } catch {
      resolve([]);
      return;
    }
    const finish = () => {
      try {
        sock.close();
      } catch {}
      resolve([...found.values()]);
    };
    sock.on("error", finish);
    sock.on("message", (msg, rinfo) => {
      const { xaddrs, scopes } = parseProbeMatch(msg.toString("utf8"));
      const xa = xaddrs.find((x) => x.includes(rinfo.address)) ?? xaddrs[0];
      let port = 80;
      try {
        if (xa) port = Number(new URL(xa).port || 80);
      } catch {}
      const name = scopeValue(scopes, "name");
      const model = scopeValue(scopes, "hardware");
      found.set(rinfo.address, { host: rinfo.address, port, name, model, brand: guessBrand(`${name ?? ""} ${model ?? ""} ${scopes.join(" ")}`) });
    });
    sock.bind(0, () => {
      const payload = Buffer.from(PROBE(randomUUID()));
      try {
        sock.send(payload, 3702, "239.255.255.250");
        setTimeout(() => sock.send(payload, 3702, "239.255.255.250"), 500);
      } catch {}
    });
    setTimeout(finish, timeoutMs);
  });
}

export function localSubnets(): string[] {
  const out = new Set<string>();
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family !== "IPv4" || i.internal) continue;
      const parts = i.address.split(".");
      if (parts[0] === "169" && parts[1] === "254") continue;
      if (!/^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(i.address)) continue;
      out.add(parts.slice(0, 3).join("."));
    }
  }
  return [...out].slice(0, 4);
}

function tcpOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = new Socket();
    let done = false;
    const end = (ok: boolean) => {
      if (done) return;
      done = true;
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs);
    s.once("connect", () => end(true));
    s.once("timeout", () => end(false));
    s.once("error", () => end(false));
    s.connect(port, host);
  });
}

async function pool<T>(items: T[], concurrency: number, deadline: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length && Date.now() < deadline) await fn(items[i++]!);
  });
  await Promise.all(workers);
}

async function httpBanner(host: string, port: number, timeoutMs: number): Promise<string> {
  try {
    const r = await fetch(`http://${host}:${port}/`, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    const body = (await r.text()).slice(0, 4000);
    return `${r.headers.get("server") ?? ""} ${r.headers.get("www-authenticate") ?? ""} ${body.match(/<title>([^<]*)<\/title>/i)?.[1] ?? ""}`;
  } catch {
    return "";
  }
}

export async function discover(opts: { budgetMs?: number; knownHosts: Set<string>; subnets?: string[] }): Promise<Candidate[]> {
  const start = Date.now();
  const budget = opts.budgetMs ?? 7500;
  const deadline = start + budget - 1200;
  const ports = [554, 2020, 8000, 80];
  const wsdP = wsDiscovery(3000);
  const open = new Map<string, number[]>();
  const hosts: string[] = [];
  for (const net of opts.subnets ?? localSubnets()) for (let h = 1; h < 255; h++) hosts.push(`${net}.${h}`);
  const jobs = hosts.flatMap((h) => ports.map((p) => [h, p] as const));
  await pool(jobs, 192, deadline, async ([h, p]) => {
    if (await tcpOpen(h, p, 700)) open.set(h, [...(open.get(h) ?? []), p]);
  });
  const wsd = await wsdP;
  const result = new Map<string, Candidate>();
  for (const w of wsd) {
    result.set(w.host, {
      host: w.host,
      port: w.port,
      brand: w.brand ?? (w.port === 2020 ? "tapo" : undefined),
      name: w.name,
      model: w.model,
      onvif: true,
      onvifPort: w.port,
      rtsp: open.get(w.host)?.includes(554) ?? false,
      openPorts: open.get(w.host) ?? [],
      alreadyAdded: opts.knownHosts.has(w.host),
    });
  }
  for (const [host, ps] of open) {
    if (!ps.includes(554) && !ps.includes(2020)) continue;
    const existing = result.get(host);
    if (existing) {
      existing.rtsp = ps.includes(554);
      existing.openPorts = ps;
      continue;
    }
    result.set(host, {
      host,
      port: ps.includes(554) ? 554 : 2020,
      brand: ps.includes(2020) ? "tapo" : undefined,
      onvif: ps.includes(2020),
      onvifPort: ps.includes(2020) ? 2020 : undefined,
      rtsp: ps.includes(554),
      openPorts: ps,
      alreadyAdded: opts.knownHosts.has(host),
    });
  }
  const left = start + budget - Date.now();
  if (left > 600) {
    const needBanner = [...result.values()].filter((c) => !c.brand && c.openPorts.includes(80)).slice(0, 32);
    await Promise.all(
      needBanner.map(async (c) => {
        const b = await httpBanner(c.host, 80, Math.min(1500, left - 300));
        c.brand = guessBrand(b) ?? (c.openPorts.includes(8000) ? "hikvision" : undefined);
      }),
    );
  }
  return [...result.values()].sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }));
}
