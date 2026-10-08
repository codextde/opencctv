// API types — mirror of docs/API.md plus the web UI extensions.

export type Role = 'admin' | 'viewer';

export interface User {
  id: string;
  username: string;
  role: Role;
  createdAt: string;
}

export interface Info {
  name: string;
  version: string;
  setupRequired: boolean;
  demo: boolean;
  features: string[];
  siteId?: string;
  demoLogin?: { username: string; password: string };
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface PairingCode {
  code: string;
  expiresAt: string;
  url: string;
}

export type FieldOption = string | { value: string; label: string };

export interface Field {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'select';
  required: boolean;
  placeholder?: string;
  options?: FieldOption[];
  /** optional extensions — rendered when present */
  help?: string;
  default?: string;
}

export type BrandId =
  | 'tapo' | 'eufy' | 'unifi' | 'reolink' | 'hikvision' | 'dahua' | 'amcrest' | 'axis' | 'foscam'
  | 'ezviz' | 'imou' | 'annke' | 'wyze' | 'ubiquiti' | 'onvif' | 'generic' | 'demo';

export interface Brand {
  id: BrandId | string;
  name: string;
  kinds: string[];
  fields: Field[];
  help: string;
  defaultPort?: number;
}

export type SourceKind = 'rtsp' | 'onvif' | 'tapo' | 'unifi' | 'http' | 'rtmp-push' | 'rtsp-push' | 'demo';
export type RecordingMode = 'continuous' | 'motion' | 'off';

export interface Camera {
  id: string;
  name: string;
  brand: BrandId | string;
  group?: string;
  order: number;
  enabled: boolean;
  source: { kind: SourceKind | string; url: string; subUrl?: string };
  recording: { mode: RecordingMode; useSubstream: boolean };
  motion: { enabled: boolean; sensitivity: number; notify: boolean };
  capabilities: { audio: boolean; twoWayAudio: boolean; ptz: boolean; substream: boolean };
  status: {
    online: boolean;
    recording: boolean;
    lastSeen?: string;
    codec?: string;
    width?: number;
    height?: number;
    fps?: number;
    bitrateKbps?: number;
    error?: string;
  };
  push?: { url: string };
}

export interface CameraCreate {
  name: string;
  brand: string;
  kind?: string;
  fields: Record<string, string>;
}

export interface CameraPatch {
  name?: string;
  group?: string;
  enabled?: boolean;
  order?: number;
  recording?: Partial<Camera['recording']>;
  motion?: Partial<Camera['motion']>;
  fields?: Record<string, string>;
}

export interface CameraTestResult {
  ok: boolean;
  error?: string;
  codec?: string;
  width?: number;
  height?: number;
  audio?: boolean;
  snapshot?: string;
}

export interface DiscoverCandidate {
  host: string;
  port: number;
  brand?: string;
  name?: string;
  model?: string;
  onvif: boolean;
  rtsp: boolean;
  alreadyAdded: boolean;
}

export interface UnifiImportResult {
  cameras: { id: string; name: string; model: string; added: boolean }[];
}

export interface Recording {
  id: string;
  cameraId: string;
  start: string;
  end: string;
  durationSec: number;
  sizeBytes: number;
  location: 'local' | 'remote' | 'both';
  uploaded: boolean;
  motion: boolean;
  videoUrl: string;
  thumbUrl: string;
}

export interface MotionEvent {
  id: string;
  cameraId: string;
  start: string;
  end?: string;
  score: number;
  snapshotUrl: string;
  recordingId?: string;
  offsetSec?: number;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface Timeline {
  ranges: { start: string; end: string; recordingId: string }[];
  events: MotionEvent[];
  days: string[];
}

export type StorageType = 'local' | 'gdrive' | 's3' | 'ftp' | 'sftp' | 'smb' | 'webdav' | 'dropbox' | 'onedrive';

export interface StorageTarget {
  id: string;
  type: StorageType | string;
  name: string;
  enabled: boolean;
  config: Record<string, string>;
  path: string;
  retentionDays: number;
  status: { ok: boolean; lastUpload?: string; usedBytes?: number; queued: number; error?: string };
}

export interface StorageTypeInfo {
  type: StorageType | string;
  name: string;
  fields: Field[];
  help: string;
}

export interface StorageInfo {
  local: { path: string; usedBytes: number; freeBytes: number; totalBytes: number; retentionDays: number; maxGB: number };
  targets: StorageTarget[];
  types: StorageTypeInfo[];
  gdrive?: { deviceFlow: boolean; browserFlow: boolean };
}

export interface StorageTargetInput {
  type: string;
  name: string;
  config: Record<string, string>;
  path: string;
  retentionDays: number;
}

export interface GdriveStartInput {
  name?: string;
  path?: string;
  retentionDays?: number;
  mode?: 'device' | 'browser';
  clientId?: string;
  clientSecret?: string;
}

export type GdriveStart =
  | { flowId: string; verificationUrl: string; userCode: string; expiresAt: string; authUrl?: undefined }
  | { flowId: string; authUrl: string; verificationUrl?: undefined; userCode?: undefined; expiresAt?: string };

export interface GdriveStatus {
  status: 'pending' | 'done' | 'expired' | 'error';
  target?: StorageTarget;
  error?: string;
}

export interface Settings {
  serverName: string;
  recording: { segmentSeconds: number; preMotionSec: number; postMotionSec: number };
  retention: { localDays: number; maxLocalGB: number; deleteLocalAfterUpload: boolean };
  motion: { defaultSensitivity: number };
  notifications: { enabled: boolean; cooldownSec: number };
  gateway: { url?: string; siteName?: string; connected: boolean; enabled: boolean };
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface ComponentStatus {
  version?: string;
  ok: boolean;
}

export interface SystemInfo {
  version: string;
  uptimeSec: number;
  platform: string;
  cpuPercent: number;
  memBytes: number;
  disk: { path: string; usedBytes: number; freeBytes: number; totalBytes: number };
  components: Record<string, ComponentStatus>;
  cameras: number;
  recordingsCount: number;
  recordingsBytes: number;
}

export interface Site {
  id: string;
  name: string;
  online: boolean;
  lastSeen?: string;
  version?: string;
  cameras: number;
}

export type WsMessage =
  | { type: 'camera'; camera: Camera }
  | { type: 'motion'; event: MotionEvent }
  | { type: 'recording'; recording: Recording }
  | { type: 'storage'; target: StorageTarget };
