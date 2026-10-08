// Dev-only preview data. Active only when localStorage['opencctv.mock'] === '1'.
import { ApiError } from './errors';
import type {
  Brand, Camera, Field, MotionEvent, Recording, Settings, Site, StorageTarget, User, WsMessage,
} from './types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const iso = (ms: number) => new Date(ms).toISOString();
const now = () => Date.now();

/* ---------------- scenes ---------------- */

type Scene = { sky: [string, string]; body: string; ir?: boolean };
const SCENES: Record<string, Scene> = {
  front: {
    sky: ['#2b3440', '#151a21'],
    body: `<rect x="0" y="0" width="640" height="360" fill="#3a3530"/><rect x="250" y="70" width="140" height="250" rx="3" fill="#1d1a17"/><rect x="262" y="84" width="116" height="222" fill="#5a3b24"/><circle cx="366" cy="200" r="5" fill="#d4a24c"/><circle cx="440" cy="110" r="70" fill="url(#glow)"/><rect x="432" y="96" width="16" height="26" rx="3" fill="#f6d27a"/><rect x="180" y="320" width="280" height="14" fill="#5d5750"/><rect x="160" y="334" width="320" height="26" fill="#6d665e"/><rect x="60" y="150" width="120" height="100" fill="#22303c" stroke="#5d5750" stroke-width="6"/><rect x="480" y="150" width="110" height="100" fill="#22303c" stroke="#5d5750" stroke-width="6"/>`,
  },
  drive: {
    sky: ['#1b2a3d', '#0e141c'],
    body: `<polygon points="0,200 640,170 640,360 0,360" fill="#2a2d30"/><polygon points="220,360 360,180 420,180 520,360" fill="#3b3e42"/><line x1="390" y1="190" x2="400" y2="360" stroke="#c9c4a8" stroke-width="3" stroke-dasharray="18 16" opacity=".5"/><g transform="translate(250 230)"><rect x="0" y="30" width="170" height="50" rx="12" fill="#56606b"/><path d="M28 30 L52 0 H122 L146 30Z" fill="#46505a"/><rect x="58" y="6" width="60" height="22" fill="#1d2731"/><circle cx="36" cy="80" r="15" fill="#111"/><circle cx="134" cy="80" r="15" fill="#111"/><rect x="4" y="44" width="20" height="10" rx="3" fill="#ffe9b0"/></g><rect x="0" y="120" width="140" height="90" fill="#232a31"/><polygon points="0,120 70,80 140,120" fill="#1a2027"/><circle cx="560" cy="60" r="2" fill="#fff" opacity=".6"/><circle cx="500" cy="40" r="1.5" fill="#fff" opacity=".5"/>`,
  },
  yard: {
    sky: ['#6f8fae', '#a9bfd0'],
    body: `<rect y="210" width="640" height="150" fill="#3f6b3a"/><rect y="230" width="640" height="130" fill="#47783f"/><g fill="#6d5a45">${Array.from({ length: 22 }, (_, i) => `<rect x="${i * 30}" y="170" width="18" height="60"/>`).join('')}</g><rect y="182" width="640" height="6" fill="#5c4b39"/><circle cx="110" cy="130" r="70" fill="#2f5a2f"/><circle cx="170" cy="150" r="55" fill="#386b36"/><rect x="132" y="180" width="14" height="50" fill="#4a3a2a"/><circle cx="520" cy="120" r="60" fill="#2c562d"/><rect x="380" y="270" width="120" height="50" rx="4" fill="#8a7458"/><rect x="390" y="248" width="100" height="22" rx="3" fill="#a08767"/>`,
  },
  garage: {
    sky: ['#2c2f33', '#202326'],
    body: `<rect width="640" height="360" fill="#2a2d31"/><rect x="120" y="40" width="400" height="240" fill="#3a3e43"/>${Array.from({ length: 7 }, (_, i) => `<rect x="120" y="${48 + i * 34}" width="400" height="3" fill="#2a2d31"/>`).join('')}<rect y="280" width="640" height="80" fill="#4a4c4f"/><rect x="20" y="80" width="80" height="200" fill="#25282c"/><rect x="24" y="120" width="72" height="4" fill="#5b5f64"/><rect x="24" y="180" width="72" height="4" fill="#5b5f64"/><rect x="30" y="96" width="20" height="24" fill="#8a4d2b"/><rect x="56" y="160" width="30" height="20" fill="#3d6a8a"/><rect x="540" y="200" width="60" height="80" rx="6" fill="#1e2124"/>`,
  },
  living: {
    sky: ['#4a3d33', '#2e2620'],
    body: `<rect width="640" height="360" fill="#4b4037"/><rect x="360" y="40" width="220" height="160" fill="#8fb2cc"/><rect x="466" y="40" width="8" height="160" fill="#4b4037"/><rect x="360" y="116" width="220" height="8" fill="#4b4037"/><rect y="270" width="640" height="90" fill="#6b5641"/><rect x="60" y="190" width="260" height="90" rx="14" fill="#33424e"/><rect x="60" y="160" width="260" height="60" rx="14" fill="#3b4b58"/><rect x="380" y="240" width="140" height="10" rx="3" fill="#2b2119"/><circle cx="40" cy="120" r="40" fill="url(#glow)"/><rect x="34" y="120" width="12" height="150" fill="#2b2119"/>`,
  },
  gate: {
    sky: ['#3c3c3c', '#1c1c1c'],
    ir: true,
    body: `<rect y="230" width="640" height="130" fill="#5a5a5a"/><rect x="0" y="0" width="200" height="300" fill="#444"/>${Array.from({ length: 9 }, (_, i) => `<rect x="${260 + i * 34}" y="110" width="10" height="160" fill="#777"/>`).join('')}<rect x="250" y="120" width="300" height="10" fill="#888"/><rect x="250" y="250" width="300" height="10" fill="#888"/><circle cx="420" cy="320" r="90" fill="#fff" opacity=".06"/>`,
  },
};
const SCENE_KEYS = ['front', 'drive', 'yard', 'garage', 'living', 'gate'];

function sceneSvg(key: string, label?: string): string {
  const s = SCENES[key] ?? SCENES.front!;
  const ts = new Date();
  const stamp = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')} ${ts.toTimeString().slice(0, 8)}`;
  const grain = (now() / 1000) % 97 | 0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360"><defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.sky[0]}"/><stop offset="1" stop-color="${s.sky[1]}"/></linearGradient><radialGradient id="glow"><stop offset="0" stop-color="#ffd98a" stop-opacity=".55"/><stop offset="1" stop-color="#ffd98a" stop-opacity="0"/></radialGradient><radialGradient id="vig" cx=".5" cy=".5" r=".75"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" seed="${grain}" numOctaves="1"/><feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .07 0"/></filter>${s.ir ? '<filter id="g"><feColorMatrix type="saturate" values="0"/></filter>' : ''}</defs><g${s.ir ? ' filter="url(#g)"' : ''}><rect width="640" height="360" fill="url(#sky)"/>${s.body}</g><rect width="640" height="360" filter="url(#n)"/><rect width="640" height="360" fill="url(#vig)"/><text x="16" y="28" font-family="ui-monospace,Menlo,monospace" font-size="15" fill="#fff" fill-opacity=".85" stroke="#000" stroke-opacity=".4" stroke-width=".6">${stamp}</text>${label ? `<text x="624" y="344" text-anchor="end" font-family="ui-monospace,Menlo,monospace" font-size="13" fill="#fff" fill-opacity=".7">${label}</text>` : ''}</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/* ---------------- state ---------------- */

const field = (key: string, label: string, type: Field['type'] = 'text', required = true, placeholder?: string, options?: string[]): Field => ({
  key, label, type, required, placeholder, options,
});
const ipFields = [field('host', 'IP address', 'text', true, '192.168.1.40'), field('username', 'Username', 'text', true, 'admin'), field('password', 'Password', 'password')];
const brand = (id: string, name: string, kinds: string[], help: string, fields = ipFields, defaultPort?: number): Brand => ({ id, name, kinds, fields, help, defaultPort });
const brands: Brand[] = [
  brand('tapo', 'TP-Link Tapo', ['tapo', 'rtsp'], 'Open the Tapo app and select the camera.\nGo to Settings > Advanced Settings > Camera Account and create a username and password.\nEnter the camera IP address and those credentials here.'),
  brand('reolink', 'Reolink', ['rtsp', 'onvif'], 'Enable RTSP and ONVIF in the Reolink app under Settings > Network > Advanced > Port Settings.\nUse the admin account of the camera.', ipFields, 554),
  brand('unifi', 'UniFi Protect', ['unifi'], 'Enable RTSPS for each camera in UniFi Protect > Camera > Settings > Advanced.\nOr use the UniFi Protect import to add all cameras at once.', [field('host', 'Console IP'), field('username', 'Username'), field('password', 'Password', 'password'), field('camera', 'Camera ID')]),
  brand('hikvision', 'Hikvision', ['rtsp', 'onvif'], 'Use the admin account. Channel 101 is the main stream, 102 the sub stream.', [...ipFields, field('channel', 'Channel', 'select', false, undefined, ['1', '2', '3', '4'])], 554),
  brand('dahua', 'Dahua', ['rtsp', 'onvif'], 'Use the admin account of the camera or NVR.', ipFields, 554),
  brand('eufy', 'eufy', ['rtsp'], 'In the eufy app enable "RTSP stream" under Storage > NAS (RTSP).\nCopy the credentials shown there.'),
  brand('amcrest', 'Amcrest', ['rtsp', 'onvif'], 'Use the admin account.', ipFields, 554),
  brand('axis', 'Axis', ['rtsp', 'onvif'], 'Create an operator user in the camera web interface.', ipFields, 554),
  brand('foscam', 'Foscam', ['rtsp'], 'Use the account you created in the Foscam app.', ipFields, 88),
  brand('ezviz', 'EZVIZ', ['rtsp'], 'Enable RTSP in the EZVIZ app. The password is the verification code on the camera label.'),
  brand('wyze', 'Wyze', ['rtsp'], 'Requires the Wyze RTSP firmware.'),
  brand('onvif', 'ONVIF', ['onvif'], 'Any ONVIF Profile S camera. The stream URLs are detected automatically.', ipFields, 80),
  brand('generic', 'Generic RTSP', ['rtsp', 'http', 'rtsp-push', 'rtmp-push'], 'Paste the RTSP or HTTP stream URL of your camera.\nFor push cameras choose a push type; you will get a URL to enter in your camera.', [field('url', 'Stream URL', 'text', true, 'rtsp://user:pass@192.168.1.40:554/stream1'), field('subUrl', 'Sub stream URL', 'text', false, 'optional')]),
];

const cam = (id: string, name: string, b: string, i: number, extra: Partial<Camera> = {}): Camera => ({
  id, name, brand: b, order: i, enabled: true, group: i < 3 ? 'Outside' : 'Inside',
  source: { kind: 'rtsp', url: `rtsp://admin:***@192.168.1.${40 + i}:554/stream1` },
  recording: { mode: i % 2 ? 'motion' : 'continuous', useSubstream: false },
  motion: { enabled: true, sensitivity: 6, notify: i < 3 },
  capabilities: { audio: true, twoWayAudio: i === 0, ptz: i === 1, substream: true },
  status: { online: true, recording: true, codec: 'H.264', width: 2560, height: 1440, fps: 20, bitrateKbps: 3100, lastSeen: iso(now()) },
  ...extra,
});
let cameras: Camera[] = [
  cam('cam_front', 'Front Door', 'reolink', 0),
  cam('cam_drive', 'Driveway', 'tapo', 1, { status: { online: true, recording: true, codec: 'H.265', width: 3840, height: 2160, fps: 15 } }),
  cam('cam_yard', 'Backyard', 'hikvision', 2),
  cam('cam_garage', 'Garage', 'eufy', 3, { status: { online: true, recording: false, codec: 'H.264', width: 1920, height: 1080, fps: 15 } }),
  cam('cam_living', 'Living Room', 'tapo', 4, { recording: { mode: 'off', useSubstream: true }, status: { online: true, recording: false, codec: 'H.264', width: 1920, height: 1080, fps: 15 } }),
  cam('cam_gate', 'Side Gate', 'dahua', 5, { group: 'Outside', status: { online: false, recording: false, error: 'Connection timed out', lastSeen: iso(now() - 3 * 3600e3) } }),
];
const sceneOf = (id: string) => SCENE_KEYS[Math.max(0, cameras.findIndex((c) => c.id === id)) % SCENE_KEYS.length]!;

const DAY = 86400e3;
const recordings: Recording[] = [];
const events: MotionEvent[] = [];
{
  const start0 = new Date();
  start0.setHours(0, 0, 0, 0);
  const from = start0.getTime() - 6 * DAY;
  for (const c of cameras.slice(0, 5)) {
    const continuous = c.recording.mode === 'continuous';
    for (let t = from; t < now() - 10 * 60e3; ) {
      const len = continuous ? 600 : 30 + Math.floor(rand() * 150);
      const motion = !continuous || rand() < 0.25;
      if (continuous || rand() < 0.08) {
        const id = `rec_${c.id}_${t}`;
        recordings.push({
          id, cameraId: c.id, start: iso(t), end: iso(t + len * 1000), durationSec: len,
          sizeBytes: Math.round(len * (continuous ? 380e3 : 260e3)), location: rand() < 0.5 ? 'both' : t < now() - 2 * DAY ? 'remote' : 'local',
          uploaded: true, motion, videoUrl: `/api/recordings/${id}/video.mp4`, thumbUrl: `/api/recordings/${id}/thumb.jpg`,
        });
        if (motion) {
          const off = Math.floor(rand() * Math.min(len, 400));
          events.push({ id: `ev_${id}`, cameraId: c.id, start: iso(t + off * 1000), end: iso(t + off * 1000 + 20e3), score: 0.5 + rand() * 0.5, snapshotUrl: `/api/events/ev_${id}/snapshot.jpg`, recordingId: id, offsetSec: off });
        }
      }
      t += len * 1000 + (continuous ? 0 : Math.floor(rand() * 40 * 60e3));
    }
  }
  recordings.sort((a, b) => b.start.localeCompare(a.start));
  events.sort((a, b) => b.start.localeCompare(a.start));
}

let users: User[] = [
  { id: 'u1', username: 'daniel', role: 'admin', createdAt: iso(now() - 40 * DAY) },
  { id: 'u2', username: 'anna', role: 'viewer', createdAt: iso(now() - 12 * DAY) },
];
let targets: StorageTarget[] = [
  { id: 't1', type: 'gdrive', name: 'Google Drive', enabled: true, config: { token: '***' }, path: 'OpenCCTV', retentionDays: 30, status: { ok: true, lastUpload: iso(now() - 90e3), usedBytes: 48.2e9, queued: 2 } },
  { id: 't2', type: 'sftp', name: 'Synology NAS', enabled: true, config: { host: 'nas.local', user: 'cctv', pass: '***' }, path: '/volume1/cctv', retentionDays: 90, status: { ok: false, lastUpload: iso(now() - 5 * 3600e3), queued: 37, error: 'dial tcp 192.168.1.5:22: connect: no route to host' } },
];
const sf = (key: string, label: string, type: Field['type'] = 'text', required = true, placeholder?: string) => field(key, label, type, required, placeholder);
const storageTypes = [
  { type: 'gdrive', name: 'Google Drive', fields: [], help: 'Sign in with your Google account. Recordings are uploaded to a folder in your Drive.' },
  { type: 's3', name: 'S3 compatible', fields: [sf('endpoint', 'Endpoint', 'text', false, 's3.amazonaws.com'), sf('bucket', 'Bucket'), sf('region', 'Region', 'text', false, 'eu-central-1'), sf('access_key_id', 'Access key ID'), sf('secret_access_key', 'Secret access key', 'password')], help: 'Works with AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi and others.' },
  { type: 'sftp', name: 'SFTP', fields: [sf('host', 'Host'), sf('port', 'Port', 'number', false, '22'), sf('user', 'Username'), sf('pass', 'Password', 'password')], help: 'Any SSH server or NAS with SFTP enabled.' },
  { type: 'smb', name: 'SMB / Windows share', fields: [sf('host', 'Host'), sf('user', 'Username'), sf('pass', 'Password', 'password'), sf('share', 'Share')], help: 'Network shares on Windows, macOS or a NAS.' },
  { type: 'webdav', name: 'WebDAV', fields: [sf('url', 'URL'), sf('user', 'Username'), sf('pass', 'Password', 'password')], help: 'Nextcloud, ownCloud and other WebDAV servers.' },
  { type: 'ftp', name: 'FTP', fields: [sf('host', 'Host'), sf('user', 'Username'), sf('pass', 'Password', 'password')], help: 'Plain FTP / FTPS servers.' },
];
let settings: Settings = {
  serverName: 'Home',
  recording: { segmentSeconds: 600, preMotionSec: 5, postMotionSec: 15 },
  retention: { localDays: 14, maxLocalGB: 500, deleteLocalAfterUpload: false },
  motion: { defaultSensitivity: 6 },
  notifications: { enabled: true, cooldownSec: 60 },
  gateway: { connected: true, enabled: true, url: 'https://gw.example.com', siteName: 'Home' },
};
let sites: Site[] = [
  { id: 's_home', name: 'Home', online: true, lastSeen: iso(now() - 5e3), version: '0.1.0', cameras: 6 },
  { id: 's_office', name: 'Office', online: true, lastSeen: iso(now() - 12e3), version: '0.1.0', cameras: 3 },
  { id: 's_cabin', name: 'Cabin', online: false, lastSeen: iso(now() - 2 * DAY), version: '0.0.9', cameras: 2 },
];
let gdrivePolls = 0;

/* ---------------- request handler ---------------- */

type Q = Record<string, string | number | boolean | undefined | null>;
const pub = ['/api/info', '/api/auth/login', '/api/auth/setup'];

export async function mockRequest(method: string, path: string, q: Q, body: unknown): Promise<unknown> {
  await sleep(120 + Math.random() * 180);
  const b = (body ?? {}) as Record<string, any>;
  const p = path.replace(/^\/+/, '/');
  const m = (re: RegExp) => p.match(re);
  if (!pub.includes(p) && !localStorage.getItem('opencctv.token')) throw new ApiError(401, 'Unauthorized');
  const R = `${method} ${p}`;
  let r: RegExpMatchArray | null;

  if (R === 'GET /api/info') return { name: settings.serverName, version: '0.1.0', setupRequired: false, demo: true, features: ['webrtc', 'hls', 'gdrive', 'gateway'], demoLogin: { username: 'demo', password: 'demo' } };
  if (R === 'POST /api/auth/login' || R === 'POST /api/auth/setup') {
    if (!b.username || !b.password) throw new ApiError(400, 'Username and password required');
    return { token: 'mock-token', user: users[0] };
  }
  if (R === 'GET /api/auth/me') return { user: users[0] };
  if (R === 'POST /api/auth/logout') return { ok: true };
  if (R === 'POST /api/auth/pairing-code') {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    return { code, expiresAt: iso(now() + 5 * 60e3), url: `opencctv://pair?server=${encodeURIComponent(location.origin)}&code=${code}` };
  }
  if (R === 'GET /api/users') return users;
  if (R === 'POST /api/users') return users.push({ id: 'u' + now(), username: b.username, role: b.role, createdAt: iso(now()) }), users.at(-1);
  if ((r = m(/^\/api\/users\/(.+)$/))) {
    if (method === 'DELETE') return (users = users.filter((u) => u.id !== r![1])), { ok: true };
    const u = users.find((x) => x.id === r![1])!;
    return Object.assign(u, { username: b.username ?? u.username, role: b.role ?? u.role });
  }

  if (R === 'GET /api/brands') return brands;
  if (R === 'GET /api/cameras') return [...cameras].sort((a, c) => a.order - c.order);
  if (R === 'POST /api/cameras/test') {
    await sleep(1200);
    return { ok: true, codec: 'H.264', width: 2560, height: 1440, audio: true, snapshot: sceneSvg('front') };
  }
  if (R === 'POST /api/cameras') {
    const c = cam('cam_' + now(), b.name, b.brand, cameras.length, b.kind?.includes('push') ? { push: { url: `rtmp://${location.hostname}:1935/live/${now().toString(36)}` }, source: { kind: b.kind, url: '' } } : {});
    cameras.push(c);
    return c;
  }
  if (R === 'POST /api/cameras/reorder') {
    (b.ids as string[]).forEach((id, i) => { const c = cameras.find((x) => x.id === id); if (c) c.order = i; });
    return { ok: true };
  }
  if ((r = m(/^\/api\/cameras\/([^/]+)\/ptz$/))) return { ok: true };
  if ((r = m(/^\/api\/cameras\/([^/]+)$/))) {
    const c = cameras.find((x) => x.id === r![1]);
    if (!c) throw new ApiError(404, 'Camera not found');
    if (method === 'DELETE') return (cameras = cameras.filter((x) => x !== c)), { ok: true };
    const { recording, motion, fields: _f, ...rest } = b;
    Object.assign(c, rest);
    if (recording) Object.assign(c.recording, recording);
    if (motion) Object.assign(c.motion, motion);
    return c;
  }
  if (R === 'GET /api/discover') {
    await sleep(2200);
    return { candidates: [
      { host: '192.168.1.40', port: 554, brand: 'reolink', name: 'Front Door', model: 'RLC-810A', onvif: true, rtsp: true, alreadyAdded: true },
      { host: '192.168.1.57', port: 554, brand: 'hikvision', model: 'DS-2CD2387G2', onvif: true, rtsp: true, alreadyAdded: false },
      { host: '192.168.1.63', port: 2020, brand: 'tapo', model: 'C320WS', onvif: true, rtsp: true, alreadyAdded: false },
      { host: '192.168.1.71', port: 554, onvif: false, rtsp: true, alreadyAdded: false },
    ] };
  }
  if (R === 'POST /api/integrations/unifi/import') {
    await sleep(1500);
    return { cameras: [{ id: 'u1', name: 'G4 Doorbell', model: 'UVC G4 Doorbell Pro', added: true }, { id: 'u2', name: 'Carport', model: 'UVC G5 Bullet', added: true }] };
  }

  if (R === 'GET /api/recordings') {
    let list = recordings.filter((x) => (!q.camera || x.cameraId === q.camera) && (!q.from || x.start >= String(q.from)) && (!q.to || x.start < String(q.to)));
    const start = Number(q.cursor ?? 0);
    const limit = Number(q.limit ?? 50);
    return { items: list.slice(start, start + limit), nextCursor: start + limit < list.length ? String(start + limit) : undefined };
  }
  if ((r = m(/^\/api\/recordings\/([^/]+)$/))) {
    const i = recordings.findIndex((x) => x.id === r![1]);
    if (i >= 0) recordings.splice(i, 1);
    return { ok: true };
  }
  if (R === 'GET /api/timeline') {
    const [y, mo, d] = String(q.day).split('-').map(Number);
    const s = new Date(y!, mo! - 1, d!).getTime();
    const inDay = (t: string) => { const v = new Date(t).getTime(); return v >= s && v < s + DAY; };
    const days = [...new Set(recordings.filter((x) => x.cameraId === q.camera).map((x) => { const dt = new Date(x.start); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; }))].sort();
    return {
      ranges: recordings.filter((x) => x.cameraId === q.camera && inDay(x.start)).map((x) => ({ start: x.start, end: x.end, recordingId: x.id })).reverse(),
      events: events.filter((e) => e.cameraId === q.camera && inDay(e.start)),
      days,
    };
  }
  if (R === 'GET /api/events') {
    const list = events.filter((e) => (!q.camera || e.cameraId === q.camera) && (!q.before || e.start < String(q.before)));
    const items = list.slice(0, Number(q.limit ?? 50));
    return { items, nextCursor: list.length > items.length ? items.at(-1)?.start : undefined };
  }

  if (R === 'GET /api/storage') return { local: { path: '/var/lib/opencctv/recordings', usedBytes: 312e9, freeBytes: 612e9, totalBytes: 1000e9, retentionDays: settings.retention.localDays, maxGB: settings.retention.maxLocalGB }, targets, types: storageTypes, gdrive: { deviceFlow: true, browserFlow: true } };
  if (R === 'POST /api/storage/targets/test') return await sleep(900), { ok: true };
  if (R === 'POST /api/storage/targets') {
    const t: StorageTarget = { id: 't' + now(), type: b.type, name: b.name, enabled: true, config: b.config, path: b.path, retentionDays: b.retentionDays, status: { ok: true, queued: 0 } };
    return targets.push(t), t;
  }
  if ((r = m(/^\/api\/storage\/targets\/(.+)$/))) {
    if (method === 'DELETE') return (targets = targets.filter((t) => t.id !== r![1])), { ok: true };
    return Object.assign(targets.find((t) => t.id === r![1])!, b);
  }
  if (R === 'POST /api/storage/gdrive/start') return (gdrivePolls = 0), b.mode === 'browser' ? { flowId: 'f1', authUrl: 'https://accounts.google.com/o/oauth2/v2/auth' } : { flowId: 'f1', verificationUrl: 'https://www.google.com/device', userCode: 'WDJB-MJHT', expiresAt: iso(now() + 15 * 60e3) };
  if ((r = m(/^\/api\/storage\/gdrive\/(.+)$/))) {
    if (++gdrivePolls < 3) return { status: 'pending' };
    const t: StorageTarget = { id: 't' + now(), type: 'gdrive', name: 'Google Drive', enabled: true, config: {}, path: 'OpenCCTV', retentionDays: 30, status: { ok: true, queued: 0 } };
    return targets.push(t), { status: 'done', target: t };
  }

  if (R === 'GET /api/settings') return structuredClone(settings);
  if (R === 'PATCH /api/settings') {
    const merge = (a: any, c: any) => { for (const k in c) c[k] && typeof c[k] === 'object' ? merge(a[k], c[k]) : (a[k] = c[k]); };
    merge(settings, b);
    return structuredClone(settings);
  }
  if (R === 'GET /api/system') return { version: '0.1.0', uptimeSec: 3 * 86400 + 7 * 3600 + 1260, platform: 'linux-arm64', cpuPercent: 14 + Math.random() * 6, memBytes: 412e6, disk: { path: '/var/lib/opencctv', usedBytes: 388e9, freeBytes: 612e9, totalBytes: 1000e9 }, components: { go2rtc: { version: '1.9.9', ok: true }, ffmpeg: { version: '7.1', ok: true }, rclone: { version: '1.68.2', ok: true } }, cameras: cameras.length, recordingsCount: recordings.length, recordingsBytes: recordings.reduce((a, x) => a + x.sizeBytes, 0) };
  if (R === 'GET /api/system/logs') {
    const lv = ['INFO', 'INFO', 'INFO', 'DEBUG', 'WARN', 'ERROR'];
    const msgs = ['recorder: segment closed cam=Front Door size=228MB', 'motion: event cam=Driveway score=0.82', 'uploader: uploaded 3 segments to Google Drive', 'go2rtc: stream started cam=Backyard codec=h264', 'sftp: retry in 30s target=Synology NAS', 'camera Side Gate: dial tcp 192.168.1.45:554: i/o timeout'];
    return { lines: Array.from({ length: 120 }, (_, i) => { const k = Math.floor(rand() * 6); return `${new Date(now() - (120 - i) * 31e3).toISOString()} ${lv[k]!.padEnd(5)} ${msgs[k]}`; }) };
  }

  if (R === 'GET /api/sites') return { items: sites };
  if (R === 'POST /api/sites') {
    const s: Site = { id: 's' + now(), name: b.name, online: false, cameras: 0 };
    return sites.push(s), { ...s, linkCode: 'OCL-' + Math.random().toString(36).slice(2, 10).toUpperCase() };
  }
  if ((r = m(/^\/api\/sites\/(.+)$/))) return (sites = sites.filter((s) => s.id !== r![1])), { ok: true };
  if (R === 'POST /api/gateway/link') return (settings.gateway = { url: b.url, siteName: settings.serverName, connected: true, enabled: true }), { ok: true, siteId: 's_home' };
  if (R === 'DELETE /api/gateway/link') return (settings.gateway = { connected: false, enabled: false }), { ok: true };
  throw new ApiError(404, `Mock: no handler for ${R}`);
}

export function mockMediaUrl(path: string, _q?: Q): string {
  let r = path.match(/\/api\/cameras\/([^/]+)\/snapshot/);
  if (r) return sceneSvg(sceneOf(decodeURIComponent(r[1]!)));
  r = path.match(/\/(?:recordings|events)\/(?:ev_)?rec_(cam_[a-z]+)_/);
  if (r) return sceneSvg(sceneOf(r[1]!));
  if (path.startsWith('/player/')) return 'about:blank';
  return '';
}

export function mockSnapshotFor(cameraId: string): string {
  return sceneSvg(sceneOf(cameraId));
}

export function mockSocket(emit: (m: WsMessage) => void): () => void {
  const t = setInterval(() => {
    const c = cameras[Math.floor(Math.random() * 3)]!;
    emit({ type: 'motion', event: { id: 'ev' + now(), cameraId: c.id, start: iso(now()), score: 0.8, snapshotUrl: '' } });
  }, 25000);
  return () => clearInterval(t);
}
