import type {
  AuthResponse, Brand, Camera, CameraCreate, CameraPatch, CameraTestResult, DeepPartial, DiscoverCandidate,
  GdriveStart, GdriveStartInput, GdriveStatus, Info, MotionEvent, Page, PairingCode, Recording, Role, Settings, Site,
  StorageInfo, StorageTarget, StorageTargetInput, SystemInfo, Timeline, UnifiImportResult, User,
} from './types';
import { ApiError } from './errors';
import { mockMediaUrl, mockRequest } from './mock';

const TOKEN_KEY = 'opencctv.token';
const MOCK_KEY = 'opencctv.mock';

/* ------------------------------------------------------------------ */
/* Token + mock flags                                                  */
/* ------------------------------------------------------------------ */

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return safeStorage()?.getItem(TOKEN_KEY) ?? null;
}

export function setToken(token: string | null): void {
  const s = safeStorage();
  if (!s) return;
  if (token) s.setItem(TOKEN_KEY, token);
  else s.removeItem(TOKEN_KEY);
}

/** Dev-only preview mode with fake data: localStorage['opencctv.mock'] = '1'. */
export function isMock(): boolean {
  return safeStorage()?.getItem(MOCK_KEY) === '1';
}

/* ------------------------------------------------------------------ */
/* Base path handling                                                  */
/* ------------------------------------------------------------------ */

let cachedBase: string | null = null;

/**
 * The UI uses hash routing, so everything in `location.pathname` is the prefix the
 * server (or a reverse proxy / gateway) mounted us under. We normalise it to end with
 * a slash and resolve every API/media path relative to it. An explicit `<base href>`
 * in the document wins.
 */
export function basePath(): string {
  if (cachedBase) return cachedBase;
  if (document.querySelector('base[href]')) {
    cachedBase = new URL('.', document.baseURI).href;
    return cachedBase;
  }
  let path = window.location.pathname || '/';
  path = path.replace(/\/index\.html?$/i, '/');
  if (!path.endsWith('/')) {
    path += '/';
    try {
      window.history.replaceState(window.history.state, '', path + window.location.search + window.location.hash);
    } catch {
      /* ignore */
    }
  }
  cachedBase = window.location.origin + path;
  return cachedBase;
}

/** Resolve an absolute-looking API path (`/api/x`) relative to the page base. */
export function apiUrl(path: string): string {
  return new URL(path.replace(/^\/+/, ''), basePath()).href;
}

export type Query = Record<string, string | number | boolean | undefined | null>;

function withQuery(url: string, query?: Query): string {
  if (!query) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    u.searchParams.set(k, String(v));
  }
  return u.href;
}

/** URL for media elements (img/video/iframe) — they can't send headers, so the token goes in the query. */
export function mediaUrl(path: string, query?: Query): string {
  if (isMock()) return mockMediaUrl(path, query);
  return withQuery(apiUrl(path), { ...query, token: getToken() ?? undefined });
}

export function wsUrl(path: string): string {
  const u = new URL(apiUrl(path));
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = getToken();
  if (token) u.searchParams.set('token', token);
  return u.href;
}

/* ------------------------------------------------------------------ */
/* Fetch wrapper                                                        */
/* ------------------------------------------------------------------ */

export { ApiError };

let unauthorizedHandler: (() => void) | null = null;
export function onUnauthorized(fn: () => void): void {
  unauthorizedHandler = fn;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
  /** don't trigger the global 401 → login redirect (login form itself) */
  quiet401?: boolean;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  if (isMock()) {
    try {
      return (await mockRequest(method, path, opts.query ?? {}, opts.body)) as T;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && !opts.quiet401) unauthorizedHandler?.();
      throw e;
    }
  }
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(withQuery(apiUrl(path), opts.query), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'Cannot reach the server. Check your connection.');
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const message =
      (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : null) ?? `${res.status} ${res.statusText || 'Request failed'}`;
    if (res.status === 401 && !opts.quiet401) unauthorizedHandler?.();
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/* ------------------------------------------------------------------ */
/* Endpoints                                                            */
/* ------------------------------------------------------------------ */

const get = <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>(path, { query, signal });
const post = <T>(path: string, body: unknown = {}) => request<T>(path, { method: 'POST', body });
const patch = <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body });
const del = <T = { ok: boolean }>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body });
const enc = encodeURIComponent;

export const api = {
  info: () => get<Info>('/api/info'),
  setup: (username: string, password: string) =>
    request<AuthResponse>('/api/auth/setup', { method: 'POST', body: { username, password }, quiet401: true }),
  login: (username: string, password: string) =>
    request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: { username, password, deviceName: 'Web browser' },
      quiet401: true,
    }),
  me: () => get<{ user: User }>('/api/auth/me'),
  logout: () => post<{ ok: boolean }>('/api/auth/logout'),
  pairingCode: (role: Role) => post<PairingCode>('/api/auth/pairing-code', { role }),

  users: () => get<User[]>('/api/users'),
  createUser: (u: { username: string; password: string; role: Role }) => post<User>('/api/users', u),
  updateUser: (id: string, u: { username?: string; password?: string; role?: Role }) =>
    patch<User>(`/api/users/${enc(id)}`, u),
  deleteUser: (id: string) => del(`/api/users/${enc(id)}`),

  brands: () => get<Brand[]>('/api/brands'),
  cameras: () => get<Camera[]>('/api/cameras'),
  createCamera: (c: CameraCreate) => post<Camera>('/api/cameras', c),
  testCamera: (c: CameraCreate) => post<CameraTestResult>('/api/cameras/test', c),
  updateCamera: (id: string, p: CameraPatch) => patch<Camera>(`/api/cameras/${enc(id)}`, p),
  deleteCamera: (id: string) => del(`/api/cameras/${enc(id)}`),
  reorderCameras: (ids: string[]) => post<{ ok: boolean }>('/api/cameras/reorder', { ids }),
  ptz: (id: string, body: { action: 'move'; pan: number; tilt: number; zoom: number } | { action: 'stop' }) =>
    post<{ ok: boolean }>(`/api/cameras/${enc(id)}/ptz`, body),
  discover: (signal?: AbortSignal) => get<{ candidates: DiscoverCandidate[] }>('/api/discover', undefined, signal),
  unifiImport: (b: { host: string; username: string; password: string; cameraIds?: string[] }) =>
    post<UnifiImportResult>('/api/integrations/unifi/import', b),

  recordings: (q: { camera?: string; from?: string; to?: string; limit?: number; cursor?: string }) =>
    get<Page<Recording>>('/api/recordings', q),
  deleteRecording: (id: string) => del(`/api/recordings/${enc(id)}`),
  timeline: (q: { camera: string; day: string; tz: string }) => get<Timeline>('/api/timeline', q),
  events: (q: { camera?: string; before?: string; limit?: number }) => get<Page<MotionEvent>>('/api/events', q),

  storage: () => get<StorageInfo>('/api/storage'),
  createTarget: (t: StorageTargetInput) => post<StorageTarget>('/api/storage/targets', t),
  testTarget: (t: StorageTargetInput) => post<{ ok: boolean; error?: string }>('/api/storage/targets/test', t),
  updateTarget: (id: string, t: Partial<StorageTargetInput> & { enabled?: boolean }) =>
    patch<StorageTarget>(`/api/storage/targets/${enc(id)}`, t),
  deleteTarget: (id: string) => del(`/api/storage/targets/${enc(id)}`),
  gdriveStart: (b: GdriveStartInput) => post<GdriveStart>('/api/storage/gdrive/start', b),
  gdriveStatus: (flowId: string) => get<GdriveStatus>(`/api/storage/gdrive/${enc(flowId)}`),

  settings: () => get<Settings>('/api/settings'),
  updateSettings: (s: DeepPartial<Settings>) => patch<Settings>('/api/settings', s),
  system: () => get<SystemInfo>('/api/system'),
  logs: (lines = 300) => get<{ lines: string[] }>('/api/system/logs', { lines }),

  sites: () => get<{ items: Site[] }>('/api/sites'),
  createSite: (name: string) => post<{ id: string; name: string; linkCode: string }>('/api/sites', { name }),
  deleteSite: (id: string) => del(`/api/sites/${enc(id)}`),
  gatewayLink: (url: string, linkCode: string) => post<{ ok: boolean; siteId: string }>('/api/gateway/link', { url, linkCode }),
  gatewayUnlink: () => del('/api/gateway/link'),
};

/* Media helpers */
export const media = {
  snapshot: (id: string, w = 640, t?: number) => mediaUrl(`/api/cameras/${enc(id)}/snapshot.jpg`, { w, t }),
  player: (id: string, quality: 'hd' | 'sd') => mediaUrl(`/player/${enc(id)}`, { quality, muted: 1 }),
  video: (id: string) => mediaUrl(`/api/recordings/${enc(id)}/video.mp4`),
  thumb: (id: string) => mediaUrl(`/api/recordings/${enc(id)}/thumb.jpg`),
  eventSnapshot: (id: string) => mediaUrl(`/api/events/${enc(id)}/snapshot.jpg`),
};
