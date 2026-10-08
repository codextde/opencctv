import type { Field } from "../brands.ts";
import { HttpError } from "../util.ts";

export type TargetType = "local" | "gdrive" | "s3" | "ftp" | "sftp" | "smb" | "webdav" | "dropbox" | "onedrive";

export type TypeInfo = { type: TargetType; name: string; fields: Field[]; help: string; secrets: string[] };

const t = (key: string, label: string, required = true, placeholder?: string): Field => ({ key, label, type: "text", required, placeholder });
const secret = (key: string, label: string, required = true): Field => ({ key, label, type: "password", required });
const num = (key: string, label: string, placeholder: string): Field => ({ key, label, type: "number", required: false, placeholder });
const sel = (key: string, label: string, options: [string, string][]): Field => ({
  key,
  label,
  type: "select",
  required: true,
  options: options.map(([value, label]) => ({ value, label })),
});

export const TARGET_TYPES: TypeInfo[] = [
  {
    type: "local",
    name: "Local folder / NAS mount",
    fields: [t("root", "Folder on this server", true, "/mnt/nas/cctv")],
    help: "Copies recordings into another folder on this machine, e.g. a mounted NAS share or USB disk.",
    secrets: [],
  },
  {
    type: "gdrive",
    name: "Google Drive",
    fields: [secret("token", "rclone token (JSON)"), t("clientId", "OAuth client id (optional)", false), secret("clientSecret", "OAuth client secret (optional)", false)],
    help: "Use the Connect Google Drive button. Alternatively run rclone authorize \"drive\" on any computer and paste the token JSON. OpenCCTV only gets access to files it creates (drive.file scope).",
    secrets: ["token", "clientSecret"],
  },
  {
    type: "s3",
    name: "S3 compatible",
    fields: [
      sel("provider", "Provider", [
        ["AWS", "Amazon S3"],
        ["Cloudflare", "Cloudflare R2"],
        ["Wasabi", "Wasabi"],
        ["Minio", "MinIO"],
        ["Backblaze", "Backblaze B2 (S3 API)"],
        ["Other", "Other S3 compatible"],
      ]),
      t("bucket", "Bucket"),
      t("accessKeyId", "Access key id"),
      secret("secretAccessKey", "Secret access key"),
      t("region", "Region", false, "us-east-1"),
      t("endpoint", "Endpoint (non-AWS)", false, "https://<account>.r2.cloudflarestorage.com"),
    ],
    help: "Works with AWS S3, Cloudflare R2, Backblaze B2, Wasabi, MinIO and other S3 compatible services. Create a key that can read, write and delete in the bucket.",
    secrets: ["secretAccessKey"],
  },
  {
    type: "ftp",
    name: "FTP / FTPS",
    fields: [t("host", "Host"), num("port", "Port", "21"), t("user", "Username"), secret("password", "Password"), sel("tls", "Encryption", [["none", "None"], ["explicit", "Explicit TLS"], ["implicit", "Implicit TLS"]])],
    help: "Any FTP server, e.g. a router USB share or a NAS.",
    secrets: ["password"],
  },
  {
    type: "sftp",
    name: "SFTP (SSH)",
    fields: [t("host", "Host"), num("port", "Port", "22"), t("user", "Username"), secret("password", "Password", false), secret("privateKey", "Private key (PEM, optional)", false)],
    help: "Any server reachable over SSH. Use a password or paste a private key.",
    secrets: ["password", "privateKey"],
  },
  {
    type: "smb",
    name: "SMB / Windows share",
    fields: [t("host", "Host"), t("share", "Share name"), t("user", "Username", false), secret("password", "Password", false), t("domain", "Domain", false, "WORKGROUP")],
    help: "Windows shares, Synology, QNAP, TrueNAS and other SMB servers.",
    secrets: ["password"],
  },
  {
    type: "webdav",
    name: "WebDAV / Nextcloud",
    fields: [
      t("url", "WebDAV URL", true, "https://cloud.example.com/remote.php/dav/files/USER"),
      sel("vendor", "Vendor", [["nextcloud", "Nextcloud"], ["owncloud", "ownCloud"], ["sharepoint", "SharePoint"], ["other", "Other"]]),
      t("user", "Username", false),
      secret("password", "Password / app password", false),
    ],
    help: "Nextcloud, ownCloud, and any other WebDAV server. Use an app password where possible.",
    secrets: ["password"],
  },
  {
    type: "dropbox",
    name: "Dropbox",
    fields: [secret("token", "rclone token (JSON)")],
    help: "Run rclone authorize \"dropbox\" on any computer with a browser and paste the resulting token JSON.",
    secrets: ["token"],
  },
  {
    type: "onedrive",
    name: "OneDrive",
    fields: [secret("token", "rclone token (JSON)"), t("driveId", "Drive id"), sel("driveType", "Drive type", [["personal", "Personal"], ["business", "Business"], ["documentLibrary", "SharePoint library"]])],
    help: "Run rclone config on any computer to create a OneDrive remote, then copy token, drive_id and drive_type from rclone.conf.",
    secrets: ["token"],
  },
];

export function typeInfo(type: string): TypeInfo {
  const ti = TARGET_TYPES.find((x) => x.type === type);
  if (!ti) throw new HttpError(400, `Unknown storage type ${type}`);
  return ti;
}

export function validateConfig(type: TargetType, config: Record<string, string>): void {
  const ti = typeInfo(type);
  for (const f of ti.fields) if (f.required && !config[f.key]) throw new HttpError(400, `${f.label} is required`);
  if (type === "local" && !/^([a-zA-Z]:[\\/]|\/|\\\\)/.test(config.root ?? "")) throw new HttpError(400, "Folder must be an absolute path");
  if (["gdrive", "dropbox", "onedrive"].includes(type)) {
    try {
      const tok = JSON.parse(config.token ?? "");
      if (!tok.access_token && !tok.refresh_token) throw new Error();
    } catch {
      throw new HttpError(400, "Token must be the JSON printed by rclone authorize");
    }
  }
  if (type === "sftp" && !config.password && !config.privateKey) throw new HttpError(400, "Password or private key is required");
  for (const [k, v] of Object.entries(config)) if (/[\r\n]/.test(v) && k !== "privateKey") throw new HttpError(400, `${k} must be a single line`);
}

export type RcloneSection = Record<string, string>;

export function rcloneSection(
  type: TargetType,
  config: Record<string, string>,
  obscure: (s: string) => string,
): RcloneSection {
  switch (type) {
    case "local":
      return { type: "local" };
    case "gdrive": {
      const s: RcloneSection = { type: "drive", scope: "drive.file", token: config.token! };
      if (config.clientId) s.client_id = config.clientId;
      if (config.clientSecret) s.client_secret = config.clientSecret;
      if (config.rootFolderId) s.root_folder_id = config.rootFolderId;
      return s;
    }
    case "s3": {
      const s: RcloneSection = {
        type: "s3",
        provider: config.provider === "Backblaze" ? "Other" : config.provider || "Other",
        access_key_id: config.accessKeyId!,
        secret_access_key: config.secretAccessKey!,
        no_check_bucket: "true",
      };
      if (config.region) s.region = config.region;
      if (config.endpoint) s.endpoint = config.endpoint;
      return s;
    }
    case "ftp": {
      const s: RcloneSection = { type: "ftp", host: config.host!, user: config.user!, pass: obscure(config.password ?? "") };
      if (config.port) s.port = String(Number(config.port));
      if (config.tls === "explicit") s.explicit_tls = "true";
      if (config.tls === "implicit") s.tls = "true";
      if (config.tls && config.tls !== "none") s.no_check_certificate = "true";
      return s;
    }
    case "sftp": {
      const s: RcloneSection = { type: "sftp", host: config.host!, user: config.user! };
      if (config.port) s.port = String(Number(config.port));
      if (config.password) s.pass = obscure(config.password);
      if (config.privateKey) s.key_pem = config.privateKey.trim().replace(/\r?\n/g, "\\n");
      s.shell_type = "none";
      return s;
    }
    case "smb": {
      const s: RcloneSection = { type: "smb", host: config.host! };
      if (config.user) s.user = config.user;
      if (config.password) s.pass = obscure(config.password);
      if (config.domain) s.domain = config.domain;
      return s;
    }
    case "webdav": {
      const s: RcloneSection = { type: "webdav", url: config.url!, vendor: config.vendor || "other" };
      if (config.user) s.user = config.user;
      if (config.password) s.pass = obscure(config.password);
      return s;
    }
    case "dropbox":
      return { type: "dropbox", token: config.token! };
    case "onedrive":
      return { type: "onedrive", token: config.token!, drive_id: config.driveId!, drive_type: config.driveType || "personal" };
  }
}

export function remoteBase(type: TargetType, config: Record<string, string>, path: string): string {
  const clean = (p: string) =>
    p
      .replace(/\\/g, "/")
      .split("/")
      .filter((s) => s && s !== "." && s !== "..")
      .join("/");
  const sub = clean(path);
  switch (type) {
    case "local": {
      const root = (config.root ?? "").replace(/[\\/]+$/, "");
      return sub ? `${root}/${sub}` : root;
    }
    case "s3":
      return [clean(config.bucket ?? ""), sub].filter(Boolean).join("/");
    case "smb":
      return [clean(config.share ?? ""), sub].filter(Boolean).join("/");
    default:
      return sub;
  }
}

export function iniSection(name: string, s: RcloneSection): string {
  return `[${name}]\n` + Object.entries(s).map(([k, v]) => `${k} = ${v}`).join("\n") + "\n";
}
