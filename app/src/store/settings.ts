import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { kvStorage } from './kv';

export type LanguagePref = 'system' | 'de' | 'en';
export type AppearancePref = 'system' | 'light' | 'dark';
export type GridColumns = 'auto' | 1 | 2 | 3;
export type LiveMode = 'auto' | 'lowLatency' | 'hls';

type Values = {
  language: LanguagePref;
  appearance: AppearancePref;
  appLock: boolean;
  lockAfterSec: number;
  notifications: boolean;
  pushPrompted: boolean;
  gridColumns: GridColumns;
  gridVideo: boolean;
  liveMode: LiveMode;
  startMuted: boolean;
  preferHd: boolean;
  group: string | null;
};

type SettingsState = Values & { set: (patch: Partial<Values>) => void };

const defaults: Values = {
  language: 'system',
  appearance: 'dark',
  appLock: false,
  lockAfterSec: 60,
  notifications: false,
  pushPrompted: false,
  gridColumns: 'auto',
  gridVideo: true,
  liveMode: 'auto',
  startMuted: true,
  preferHd: true,
  group: null,
};

export const useSettings = create<SettingsState>()(
  persist((set) => ({ ...defaults, set: (patch) => set(patch) }), { name: 'settings', version: 1, storage: kvStorage }),
);

export const settings = () => useSettings.getState();
