import type {
  AuthResponse,
  Brand,
  Camera,
  CameraTestResult,
  DiscoveryCandidate,
  GdriveStart,
  GdriveStatus,
  MotionEvent,
  Page,
  Recording,
  ServerInfo,
  ServerSettings,
  Site,
  StorageOverview,
  StorageTarget,
  SystemInfo,
  Timeline,
  User,
} from './types';
import { joinUrl, mediaUrl, withQuery } from './url';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

type Options = { timeoutMs?: number; signal?: AbortSignal };

export async function http<T>(base: string, method: string, path: string, token: string | null, body?: unknown, opts: Options = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
  opts.signal?.addEventListener('abort', () => controller.abort());
  let res: Response;
  try {
    res = await fetch(joinUrl(base, path), {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : null),
        ...(token ? { Authorization: `Bearer ${token}` } : null),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    throw new ApiError(0, controller.signal.aborted ? 'timeout' : e instanceof Error ? e.message : 'network', controller.signal.aborted ? 'timeout' : 'network');
  } finally {
    clearTimeout(timeout);
  }
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!res.ok) {
    const err = json as { error?: string; message?: string; code?: string } | null;
    throw new ApiError(res.status, err?.error || err?.message || `HTTP ${res.status}`, err?.code);
  }
  return json as T;
}

export const publicApi = {
  info: (base: string, opts?: Options) => http<ServerInfo>(base, 'GET', '/api/info', null, undefined, { timeoutMs: 8000, ...opts }),
  login: (base: string, username: string, password: string, deviceName?: string) =>
    http<AuthResponse>(base, 'POST', '/api/auth/login', null, { username, password, deviceName }),
  setup: (base: string, username: string, password: string) => http<AuthResponse>(base, 'POST', '/api/auth/setup', null, { username, password }),
  pair: (base: string, code: string, deviceName?: string) => http<AuthResponse>(base, 'POST', '/api/auth/pair', null, { code, deviceName }),
};

export type ServerApi = ReturnType<typeof createApi>;

export function createApi(base: string, token: string | null, onUnauthorized?: () => void) {
  const call = async <T>(method: string, path: string, body?: unknown, opts?: Options) => {
    try {
      return await http<T>(base, method, path, token, body, opts);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onUnauthorized?.();
      throw e;
    }
  };
  const get = <T>(path: string, query?: Record<string, string | number | undefined>, opts?: Options) => call<T>('GET', query ? withQuery(path, query) : path, undefined, opts);

  return {
    base,
    token,
    media: (path: string, params?: Record<string, string | number | boolean | undefined>) => mediaUrl(base, path, token, params),
    info: () => get<ServerInfo>('/api/info'),
    me: () => get<{ user: User }>('/api/auth/me'),
    logout: () => call<{ ok: boolean }>('POST', '/api/auth/logout'),
    pairingCode: (role?: 'admin' | 'viewer') => call<{ code: string; expiresAt: string; url: string }>('POST', '/api/auth/pairing-code', { role }),

    users: () => get<User[]>('/api/users'),
    createUser: (u: { username: string; password: string; role: string }) => call<User>('POST', '/api/users', u),
    updateUser: (id: string, u: Partial<{ username: string; password: string; role: string }>) => call<User>('PATCH', `/api/users/${id}`, u),
    deleteUser: (id: string) => call<{ ok: boolean }>('DELETE', `/api/users/${id}`),

    brands: () => get<Brand[]>('/api/brands'),
    cameras: () => get<Camera[]>('/api/cameras'),
    createCamera: (body: Record<string, unknown>) => call<Camera>('POST', '/api/cameras', body, { timeoutMs: 30000 }),
    updateCamera: (id: string, patch: Record<string, unknown>) => call<Camera>('PATCH', `/api/cameras/${id}`, patch),
    deleteCamera: (id: string) => call<{ ok: boolean }>('DELETE', `/api/cameras/${id}`),
    testCamera: (body: Record<string, unknown>) => call<CameraTestResult>('POST', '/api/cameras/test', body, { timeoutMs: 30000 }),
    reorder: (ids: string[]) => call<{ ok: boolean }>('POST', '/api/cameras/reorder', { ids }),
    ptz: (id: string, body: { action: 'move'; pan: number; tilt: number; zoom: number } | { action: 'stop' } | { action: 'preset'; preset: string }) =>
      call<{ ok: boolean }>('POST', `/api/cameras/${id}/ptz`, body, { timeoutMs: 5000 }),
    discover: () => get<{ candidates: DiscoveryCandidate[] }>('/api/discover', undefined, { timeoutMs: 20000 }),
    unifiImport: (body: { host: string; username: string; password: string; cameraIds?: string[] }) =>
      call<{ cameras: { id: string; name: string; model: string; added: boolean }[] }>('POST', '/api/integrations/unifi/import', body, { timeoutMs: 30000 }),

    snapshotUrl: (id: string, w?: number) => mediaUrl(base, `/api/cameras/${id}/snapshot.jpg`, token, { w }),
    liveHlsUrl: (id: string, quality: 'hd' | 'sd') => mediaUrl(base, `/api/cameras/${id}/live.m3u8`, token, { quality }),
    playerUrl: (id: string, quality: 'hd' | 'sd', muted: boolean, talk = false) =>
      mediaUrl(base, `/player/${id}`, token, { quality, muted: muted ? 1 : 0, talk: talk ? 1 : undefined, state: 0, embed: 'app' }),

    recordings: (q: { camera?: string; from?: string; to?: string; limit?: number; cursor?: string }) => get<Page<Recording>>('/api/recordings', q),
    deleteRecording: (id: string) => call<{ ok: boolean }>('DELETE', `/api/recordings/${id}`),
    timeline: (camera: string, day: string, tz: string) => get<Timeline>('/api/timeline', { camera, day, tz }),
    events: (q: { camera?: string; from?: string; before?: string; limit?: number }) => get<Page<MotionEvent>>('/api/events', q),
    clip: (cameraId: string, start: string, end: string) => call<{ url: string }>('POST', '/api/clips', { cameraId, start, end }, { timeoutMs: 120000 }),

    storage: () => get<StorageOverview>('/api/storage'),
    createTarget: (body: Partial<StorageTarget>) => call<StorageTarget>('POST', '/api/storage/targets', body, { timeoutMs: 30000 }),
    updateTarget: (id: string, patch: Partial<StorageTarget>) => call<StorageTarget>('PATCH', `/api/storage/targets/${id}`, patch),
    deleteTarget: (id: string) => call<{ ok: boolean }>('DELETE', `/api/storage/targets/${id}`),
    testTarget: (body: Partial<StorageTarget>) => call<{ ok: boolean; error?: string }>('POST', '/api/storage/targets/test', body, { timeoutMs: 30000 }),
    gdriveStart: (body: { name?: string; path?: string }) => call<GdriveStart>('POST', '/api/storage/gdrive/start', body),
    gdriveStatus: (flowId: string) => get<GdriveStatus>(`/api/storage/gdrive/${flowId}`),

    settings: () => get<ServerSettings>('/api/settings'),
    updateSettings: (patch: Record<string, unknown>) => call<ServerSettings>('PATCH', '/api/settings', patch),
    system: () => get<SystemInfo>('/api/system'),
    logs: (lines = 200) => get<{ lines: string[] }>('/api/system/logs', { lines }),

    registerPush: (expoPushToken: string, platform: string, cameras?: string[]) => call<{ ok: boolean }>('POST', '/api/push/register', { expoPushToken, platform, cameras }),
    unregisterPush: (expoPushToken: string) => call<{ ok: boolean }>('DELETE', '/api/push/register', { expoPushToken }),

    sites: () => get<{ items: Site[] }>('/api/sites'),
    createSite: (name: string) => call<{ id: string; name: string; linkCode: string }>('POST', '/api/sites', { name }),
    deleteSite: (id: string) => call<{ ok: boolean }>('DELETE', `/api/sites/${id}`),
    linkGateway: (url: string, linkCode: string) => call<{ ok: boolean; siteId: string }>('POST', '/api/gateway/link', { url, linkCode }, { timeoutMs: 30000 }),
    unlinkGateway: () => call<{ ok: boolean }>('DELETE', '/api/gateway/link'),
  };
}
