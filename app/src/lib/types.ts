export type Role = 'admin' | 'viewer';

export type User = { id: string; username: string; role: Role; createdAt: string };

export type ServerInfo = {
  name: string;
  version: string;
  setupRequired: boolean;
  demo: boolean;
  features: string[];
  siteId?: string;
};

export type AuthResponse = { token: string; user: User };

export type SourceKind = 'rtsp' | 'onvif' | 'tapo' | 'unifi' | 'http' | 'rtmp-push' | 'rtsp-push' | 'demo';
export type RecordingMode = 'continuous' | 'motion' | 'off';

export type PtzPreset = { id: string; name: string };

export type Camera = {
  id: string;
  name: string;
  brand: string;
  group?: string;
  order: number;
  enabled: boolean;
  source: { kind: SourceKind; url: string; subUrl?: string };
  recording: { mode: RecordingMode; useSubstream: boolean };
  motion: { enabled: boolean; sensitivity: number; notify: boolean };
  capabilities: { audio: boolean; twoWayAudio: boolean; ptz: boolean; substream: boolean; ptzPresets?: PtzPreset[] };
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
};

export type FieldType = 'text' | 'password' | 'number' | 'select';

export type Field = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  placeholder?: string;
  options?: (string | { value: string; label: string })[];
  help?: string;
  default?: string;
};

export type Brand = { id: string; name: string; kinds: string[]; fields: Field[]; help: string; defaultPort?: number };

export type CameraTestResult = { ok: boolean; error?: string; codec?: string; width?: number; height?: number; audio?: boolean; snapshot?: string };

export type DiscoveryCandidate = {
  host: string;
  port: number;
  brand?: string;
  name?: string;
  model?: string;
  onvif: boolean;
  rtsp: boolean;
  alreadyAdded: boolean;
};

export type Recording = {
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
};

export type MotionEvent = {
  id: string;
  cameraId: string;
  start: string;
  end?: string;
  score: number;
  snapshotUrl: string;
  recordingId?: string;
  offsetSec?: number;
};

export type TimelineRange = { start: string; end: string; recordingId: string };

export type Timeline = { ranges: TimelineRange[]; events: MotionEvent[]; days: string[] };

export type Page<T> = { items: T[]; nextCursor?: string };

export type StorageType = 'local' | 'gdrive' | 's3' | 'ftp' | 'sftp' | 'smb' | 'webdav' | 'dropbox' | 'onedrive';

export type StorageTarget = {
  id: string;
  type: StorageType;
  name: string;
  enabled: boolean;
  config: Record<string, string>;
  path: string;
  retentionDays: number;
  status: { ok: boolean; lastUpload?: string; usedBytes?: number; queued: number; error?: string };
};

export type StorageOverview = {
  local: { path: string; usedBytes: number; freeBytes: number; totalBytes: number; retentionDays: number; maxGB: number };
  targets: StorageTarget[];
  types: { type: StorageType; name: string; fields: Field[]; help: string }[];
};

export type GdriveStart = { flowId: string; verificationUrl?: string; userCode?: string; expiresAt?: string; authUrl?: string };
export type GdriveStatus = { status: 'pending' | 'done' | 'expired' | 'error'; target?: StorageTarget; error?: string };

export type ServerSettings = {
  serverName: string;
  recording: { segmentSeconds: number; preMotionSec: number; postMotionSec: number };
  retention: { localDays: number; maxLocalGB: number; deleteLocalAfterUpload: boolean };
  motion: { defaultSensitivity: number };
  notifications: { enabled: boolean; cooldownSec: number };
  gateway: { url?: string; siteName?: string; connected: boolean; enabled: boolean };
};

export type Component = { version: string; ok: boolean };

export type SystemInfo = {
  version: string;
  uptimeSec: number;
  platform: string;
  cpuPercent: number;
  memBytes: number;
  disk: { usedBytes?: number; freeBytes?: number; totalBytes?: number; path?: string };
  components: { go2rtc: Component; ffmpeg: Component; rclone: Component } & Record<string, Component>;
  cameras: number;
  recordingsCount: number;
  recordingsBytes: number;
};

export type Site = { id: string; name: string; online: boolean; lastSeen?: string; version?: string; cameras?: number };

export type WsMessage =
  | { type: 'camera'; camera: Camera }
  | { type: 'motion'; event: MotionEvent }
  | { type: 'recording'; recording: Recording }
  | { type: 'storage'; target: StorageTarget };
