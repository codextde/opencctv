import type { DB } from "./db.ts";
import { getSetting, setSetting } from "./db.ts";
import { clamp, deepMerge, isPlainObject } from "./util.ts";

export type Settings = {
  serverName: string;
  recording: { segmentSeconds: number; preMotionSec: number; postMotionSec: number };
  retention: { localDays: number; maxLocalGB: number; deleteLocalAfterUpload: boolean };
  motion: { defaultSensitivity: number };
  notifications: { enabled: boolean; cooldownSec: number };
};

export const DEFAULT_SETTINGS: Settings = {
  serverName: "OpenCCTV",
  recording: { segmentSeconds: 300, preMotionSec: 5, postMotionSec: 10 },
  retention: { localDays: 14, maxLocalGB: 0, deleteLocalAfterUpload: false },
  motion: { defaultSensitivity: 5 },
  notifications: { enabled: true, cooldownSec: 60 },
};

function sanitize(s: Settings): Settings {
  return {
    serverName: String(s.serverName || DEFAULT_SETTINGS.serverName).slice(0, 80),
    recording: {
      segmentSeconds: clamp(Math.round(Number(s.recording.segmentSeconds) || 300), 10, 3600),
      preMotionSec: clamp(Math.round(Number(s.recording.preMotionSec) || 0), 0, 120),
      postMotionSec: clamp(Math.round(Number(s.recording.postMotionSec) || 0), 0, 600),
    },
    retention: {
      localDays: clamp(Math.round(Number(s.retention.localDays) || 0), 0, 3650),
      maxLocalGB: clamp(Number(s.retention.maxLocalGB) || 0, 0, 1_000_000),
      deleteLocalAfterUpload: Boolean(s.retention.deleteLocalAfterUpload),
    },
    motion: { defaultSensitivity: clamp(Math.round(Number(s.motion.defaultSensitivity) || 5), 1, 10) },
    notifications: {
      enabled: Boolean(s.notifications.enabled),
      cooldownSec: clamp(Math.round(Number(s.notifications.cooldownSec) || 0), 0, 86400),
    },
  };
}

export class SettingsStore {
  private cache: Settings;
  private listeners: ((s: Settings, prev: Settings) => void)[] = [];

  constructor(private db: DB, overrides: Partial<Settings> = {}) {
    const stored = getSetting<Settings>(db, "settings");
    this.cache = sanitize(deepMerge(deepMerge(DEFAULT_SETTINGS, overrides), stored ?? {}));
  }

  get(): Settings {
    return this.cache;
  }

  patch(patch: unknown): Settings {
    if (!isPlainObject(patch)) return this.cache;
    const { gateway: _g, ...rest } = patch as Record<string, unknown>;
    const prev = this.cache;
    this.cache = sanitize(deepMerge(this.cache, rest));
    setSetting(this.db, "settings", this.cache);
    for (const l of this.listeners) l(this.cache, prev);
    return this.cache;
  }

  onChange(fn: (s: Settings, prev: Settings) => void): void {
    this.listeners.push(fn);
  }
}
