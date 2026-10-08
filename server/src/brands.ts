import { HttpError } from "./util.ts";

export type SourceKind = "rtsp" | "onvif" | "tapo" | "unifi" | "http" | "rtmp-push" | "rtsp-push" | "demo";
export type BrandId =
  | "tapo" | "eufy" | "unifi" | "reolink" | "hikvision" | "dahua" | "amcrest" | "axis" | "foscam"
  | "ezviz" | "imou" | "annke" | "wyze" | "ubiquiti" | "onvif" | "generic" | "demo";

export type Field = {
  key: string;
  label: string;
  type: "text" | "password" | "number" | "select";
  required: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
  help?: string;
  default?: string;
};

export type Brand = { id: BrandId; name: string; kinds: SourceKind[]; fields: Field[]; help: string; defaultPort?: number };

export type BuiltSource = {
  kind: SourceKind;
  url: string;
  subUrl?: string;
  extra?: string[];
  twoWayAudio?: boolean;
  ptzPort?: number;
};

const host: Field = { key: "host", label: "IP address or hostname", type: "text", required: true, placeholder: "192.168.1.50" };
const user = (placeholder = "admin"): Field => ({ key: "username", label: "Username", type: "text", required: false, placeholder });
const pass: Field = { key: "password", label: "Password", type: "password", required: false };
const port = (p: number): Field => ({ key: "port", label: "RTSP port", type: "number", required: false, placeholder: String(p), default: String(p) });
const channel: Field = { key: "channel", label: "Channel", type: "number", required: false, placeholder: "1", default: "1", help: "Only for NVR/DVR recorders" };
const onvifPort = (p: number): Field => ({ key: "onvifPort", label: "ONVIF port (PTZ)", type: "number", required: false, placeholder: String(p), default: String(p), help: "Used for pan/tilt/zoom control" });

export const BRANDS: Brand[] = [
  {
    id: "tapo",
    name: "TP-Link Tapo",
    kinds: ["rtsp", "tapo"],
    defaultPort: 554,
    fields: [
      host,
      { key: "username", label: "Camera account username", type: "text", required: true, placeholder: "from the Tapo app" },
      { key: "password", label: "Camera account password", type: "password", required: true },
      { key: "cloudPassword", label: "TP-Link cloud password (optional, enables two-way audio)", type: "password", required: false },
    ],
    help: [
      "In the Tapo app open the camera, tap the gear icon, then Advanced Settings > Camera Account and create a username and password (this is not your TP-Link ID).",
      "Main stream: rtsp://user:pass@IP:554/stream1, sub stream: stream2. PTZ models (C200, C210, C225, C500 ...) are controlled through ONVIF on port 2020.",
      "Optional: enter your TP-Link cloud password to enable two-way audio through the tapo:// protocol.",
    ].join("\n"),
  },
  {
    id: "eufy",
    name: "Eufy",
    kinds: ["rtsp"],
    defaultPort: 554,
    fields: [host, user(""), pass, port(554)],
    help: [
      "RTSP must be enabled per camera in the Eufy app: Camera > Settings > Storage > NAS (RTSP) (HomeBase 3: Storage > NAS (RTSP)). Set a username and password there.",
      "Stream URL: rtsp://user:pass@IP/live0. Battery cameras only stream while RTSP is active and drain faster.",
    ].join("\n"),
  },
  {
    id: "unifi",
    name: "UniFi Protect",
    kinds: ["unifi", "rtsp"],
    defaultPort: 7441,
    fields: [
      { key: "host", label: "Protect console IP (UDM, UNVR, Cloud Key)", type: "text", required: true, placeholder: "192.168.1.1" },
      { key: "alias", label: "RTSP alias (high quality)", type: "text", required: true, placeholder: "aBcDeFgHiJkLmNoP" },
      { key: "subAlias", label: "RTSP alias (low quality, optional)", type: "text", required: false },
    ],
    help: [
      "Easiest: use the UniFi Protect import, which logs in, enables RTSP and adds all cameras.",
      "Manual: in Protect open the camera > Settings > Advanced > RTSP and enable a quality. Copy the alias from the URL rtsps://IP:7441/ALIAS?enableSrtp.",
    ].join("\n"),
  },
  {
    id: "reolink",
    name: "Reolink",
    kinds: ["rtsp"],
    defaultPort: 554,
    fields: [host, user(), pass, port(554), channel, onvifPort(8000)],
    help: [
      "Enable RTSP and ONVIF in the Reolink app or web UI under Network > Advanced > Server Settings.",
      "Main: rtsp://user:pass@IP:554/h264Preview_01_main, sub: h264Preview_01_sub. For 4K/H.265 models the same paths work with h265 in recent firmware.",
    ].join("\n"),
  },
  {
    id: "hikvision",
    name: "Hikvision",
    kinds: ["rtsp"],
    defaultPort: 554,
    fields: [host, user(), pass, port(554), channel, onvifPort(80)],
    help: "Main: rtsp://user:pass@IP:554/Streaming/Channels/101, sub: 102. For channel 2 use 201/202. Enable ONVIF under Network > Advanced for PTZ.",
  },
  {
    id: "dahua",
    name: "Dahua",
    kinds: ["rtsp"],
    defaultPort: 554,
    fields: [host, user(), pass, port(554), channel, onvifPort(80)],
    help: "Main: rtsp://user:pass@IP:554/cam/realmonitor?channel=1&subtype=0, sub: subtype=1.",
  },
  {
    id: "amcrest",
    name: "Amcrest",
    kinds: ["rtsp"],
    defaultPort: 554,
    fields: [host, user(), pass, port(554), channel, onvifPort(80)],
    help: "Amcrest uses the Dahua URL scheme: rtsp://user:pass@IP:554/cam/realmonitor?channel=1&subtype=0 (sub: subtype=1).",
  },
  {
    id: "imou",
    name: "Imou",
    kinds: ["rtsp"],
    defaultPort: 554,
    fields: [host, user(), { ...pass, label: "Password (safety code on the camera label)" }, port(554), channel],
    help: "Imou uses the Dahua URL scheme. Username is admin, the password is the safety code on the camera label unless you changed it.",
  },
  {
    id: "annke",
    name: "Annke",
    kinds: ["rtsp"],
    defaultPort: 554,
    fields: [host, user(), pass, port(554), channel, onvifPort(80)],
    help: "Most Annke models use the Dahua scheme /cam/realmonitor?channel=1&subtype=0. Hikvision-based models work with the Hikvision preset instead.",
  },
  {
    id: "axis",
    name: "Axis",
    kinds: ["rtsp"],
    defaultPort: 554,
    fields: [host, user("root"), pass, port(554), onvifPort(80)],
    help: "rtsp://user:pass@IP/axis-media/media.amp. The sub stream requests a lower resolution with ?resolution=640x360.",
  },
  {
    id: "foscam",
    name: "Foscam",
    kinds: ["rtsp"],
    defaultPort: 88,
    fields: [host, user(), pass, port(88), onvifPort(888)],
    help: "Foscam serves RTSP on port 88: rtsp://user:pass@IP:88/videoMain, sub: videoSub.",
  },
  {
    id: "ezviz",
    name: "EZVIZ",
    kinds: ["rtsp"],
    defaultPort: 554,
    fields: [host, { ...pass, label: "Verification code (camera label)", required: true }, port(554)],
    help: "Enable RTSP in the EZVIZ app (Settings > LAN Live View / RTSP). Username is admin, password is the 6-letter verification code. URL: /h264/ch1/main/av_stream.",
  },
  {
    id: "wyze",
    name: "Wyze",
    kinds: ["rtsp"],
    defaultPort: 554,
    fields: [host, user(""), pass],
    help: "Requires the official Wyze RTSP firmware (or wz_mini_hacks). Enable RTSP in the Wyze app under Advanced Settings and copy the credentials. URL: rtsp://user:pass@IP/live.",
  },
  {
    id: "ubiquiti",
    name: "Ubiquiti (standalone)",
    kinds: ["rtsp"],
    defaultPort: 554,
    fields: [host, user("ubnt"), pass, port(554)],
    help: "Standalone UniFi G3/G4 cameras (not adopted by Protect): rtsp://IP:554/s0 (main) and /s1 (sub). Cameras adopted by Protect should use the UniFi Protect preset.",
  },
  {
    id: "onvif",
    name: "ONVIF camera",
    kinds: ["onvif"],
    defaultPort: 80,
    fields: [host, user(), pass, { key: "port", label: "ONVIF port", type: "number", required: false, placeholder: "80" }],
    help: "Works with most IP cameras. The stream URL is discovered automatically through ONVIF. Tapo uses port 2020, Reolink 8000, Foscam 888.",
  },
  {
    id: "generic",
    name: "Other (RTSP / HTTP / push)",
    kinds: ["rtsp", "http", "rtsp-push", "rtmp-push"],
    fields: [
      {
        key: "kind",
        label: "Type",
        type: "select",
        required: true,
        options: [
          { value: "rtsp", label: "RTSP URL" },
          { value: "http", label: "HTTP MJPEG / JPEG URL" },
          { value: "rtsp-push", label: "Camera pushes RTSP to this server" },
          { value: "rtmp-push", label: "Camera pushes RTMP to this server" },
        ],
      },
      { key: "url", label: "Main stream URL", type: "text", required: false, placeholder: "rtsp://user:pass@192.168.1.50:554/stream" },
      { key: "subUrl", label: "Sub stream URL (optional)", type: "text", required: false },
    ],
    help: "Any RTSP, RTSPS, HTTP MJPEG or JPEG snapshot URL. For push cameras the server shows the URL the camera must publish to after saving.",
  },
];

export function getBrand(id: string): Brand | undefined {
  return BRANDS.find((b) => b.id === id);
}

export function publicBrands(): Brand[] {
  return BRANDS;
}

export function cred(fields: Record<string, string>, defaultUser = ""): string {
  const u = fields.username ?? defaultUser;
  const p = fields.password ?? "";
  if (!u && !p) return "";
  return `${encodeURIComponent(u)}${p ? ":" + encodeURIComponent(p) : ""}@`;
}

function hp(fields: Record<string, string>, def: number): string {
  const h = (fields.host ?? "").trim();
  if (!h) throw new HttpError(400, "Host is required");
  if (!/^[a-zA-Z0-9.\-:\[\]]+$/.test(h)) throw new HttpError(400, "Invalid host");
  const p = Number(fields.port || def);
  return p === def && def === 554 ? `${h}:554` : `${h}:${p}`;
}

function ch(fields: Record<string, string>): number {
  const c = Number(fields.channel || 1);
  return Number.isInteger(c) && c > 0 && c < 256 ? c : 1;
}

export function buildSource(brandId: string, kind: string | undefined, fields: Record<string, string>): BuiltSource {
  const f = Object.fromEntries(Object.entries(fields ?? {}).map(([k, v]) => [k, String(v ?? "").trim()]));
  const c = cred(f);
  switch (brandId) {
    case "tapo": {
      const h = hp({ ...f, port: "554" }, 554);
      const extra = f.cloudPassword ? [`tapo://${encodeURIComponent(f.cloudPassword)}@${f.host}`] : [];
      return { kind: f.cloudPassword ? "tapo" : "rtsp", url: `rtsp://${c}${h}/stream1`, subUrl: `rtsp://${c}${h}/stream2`, extra, twoWayAudio: extra.length > 0, ptzPort: 2020 };
    }
    case "eufy":
      return { kind: "rtsp", url: `rtsp://${c}${hp(f, 554)}/live0` };
    case "unifi": {
      const h = (f.host ?? "").trim();
      if (!h || !/^[a-zA-Z0-9.\-:\[\]]+$/.test(h)) throw new HttpError(400, "Host is required");
      if (!f.alias || !/^[A-Za-z0-9_-]+$/.test(f.alias)) throw new HttpError(400, "RTSP alias is required");
      const sub = f.subAlias && /^[A-Za-z0-9_-]+$/.test(f.subAlias) ? `rtspx://${h}:7441/${f.subAlias}` : undefined;
      return { kind: "unifi", url: `rtspx://${h}:7441/${f.alias}`, subUrl: sub };
    }
    case "reolink": {
      const n = String(ch(f)).padStart(2, "0");
      const h = hp(f, 554);
      return { kind: "rtsp", url: `rtsp://${c}${h}/h264Preview_${n}_main`, subUrl: `rtsp://${c}${h}/h264Preview_${n}_sub`, ptzPort: Number(f.onvifPort || 8000) };
    }
    case "hikvision": {
      const h = hp(f, 554);
      const n = ch(f);
      return { kind: "rtsp", url: `rtsp://${c}${h}/Streaming/Channels/${n}01`, subUrl: `rtsp://${c}${h}/Streaming/Channels/${n}02`, ptzPort: Number(f.onvifPort || 80) };
    }
    case "dahua":
    case "amcrest":
    case "imou":
    case "annke": {
      const h = hp(f, 554);
      const n = ch(f);
      return {
        kind: "rtsp",
        url: `rtsp://${c}${h}/cam/realmonitor?channel=${n}&subtype=0`,
        subUrl: `rtsp://${c}${h}/cam/realmonitor?channel=${n}&subtype=1`,
        ptzPort: Number(f.onvifPort || 80),
      };
    }
    case "axis": {
      const h = hp(f, 554);
      return { kind: "rtsp", url: `rtsp://${c}${h}/axis-media/media.amp`, subUrl: `rtsp://${c}${h}/axis-media/media.amp?resolution=640x360`, ptzPort: Number(f.onvifPort || 80) };
    }
    case "foscam": {
      const h = hp(f, 88);
      return { kind: "rtsp", url: `rtsp://${c}${h}/videoMain`, subUrl: `rtsp://${c}${h}/videoSub`, ptzPort: Number(f.onvifPort || 888) };
    }
    case "ezviz": {
      const h = hp(f, 554);
      const c2 = cred({ username: "admin", password: f.password ?? "" });
      return { kind: "rtsp", url: `rtsp://${c2}${h}/h264/ch1/main/av_stream`, subUrl: `rtsp://${c2}${h}/h264/ch1/sub/av_stream` };
    }
    case "wyze":
      return { kind: "rtsp", url: `rtsp://${c}${hp(f, 554)}/live` };
    case "ubiquiti": {
      const h = hp(f, 554);
      return { kind: "rtsp", url: `rtsp://${c}${h}/s0`, subUrl: `rtsp://${c}${h}/s1` };
    }
    case "onvif": {
      const h = (f.host ?? "").trim();
      if (!h || !/^[a-zA-Z0-9.\-:\[\]]+$/.test(h)) throw new HttpError(400, "Host is required");
      const p = Number(f.port || 80);
      return { kind: "onvif", url: `onvif://${c}${h}:${p}`, ptzPort: p };
    }
    case "generic":
    default: {
      const k = (kind || f.kind || guessKind(f.url ?? "")) as SourceKind;
      if (k === "rtsp-push" || k === "rtmp-push") return { kind: k, url: "" };
      const url = f.url ?? "";
      validateStreamUrl(url);
      if (f.subUrl) validateStreamUrl(f.subUrl);
      if (k === "onvif" || url.startsWith("onvif://")) return { kind: "onvif", url, subUrl: f.subUrl || undefined };
      return { kind: k === "http" || /^https?:/.test(url) ? "http" : "rtsp", url, subUrl: f.subUrl || undefined };
    }
  }
}

function guessKind(url: string): SourceKind {
  if (/^https?:/i.test(url)) return "http";
  if (/^onvif:/i.test(url)) return "onvif";
  return "rtsp";
}

export function validateStreamUrl(url: string): void {
  if (!url) throw new HttpError(400, "Stream URL is required");
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new HttpError(400, "Invalid stream URL");
  }
  if (!["rtsp:", "rtsps:", "rtspx:", "http:", "https:", "onvif:", "rtmp:", "rtmps:", "tapo:"].includes(u.protocol)) {
    throw new HttpError(400, `Unsupported URL scheme ${u.protocol}`);
  }
  if (/[\s\n\r#]/.test(url)) throw new HttpError(400, "Stream URL must not contain spaces or #");
}

export function hostFromUrl(url: string): string | undefined {
  try {
    return new URL(url.replace(/^(rtspx|onvif|tapo):/, "http:")).hostname || undefined;
  } catch {
    return undefined;
  }
}

export function credsFromUrl(url: string): { username: string; password: string } {
  try {
    const u = new URL(url.replace(/^[a-z0-9+.-]+:/i, "http:"));
    return { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
  } catch {
    return { username: "", password: "" };
  }
}
