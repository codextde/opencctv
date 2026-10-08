# OpenCCTV HTTP API (v1)

Shared contract between `server/` and `app/`. JSON everywhere, ISO 8601 UTC timestamps, ids are short url-safe strings.

## Auth

- `Authorization: Bearer <token>` on every `/api/*` call except the public ones below.
- Media URLs (`*.m3u8`, `*.ts`, `*.m4s`, `*.mp4`, `*.jpg`, `/player/*`) also accept `?token=<token>` because native players can't always send headers.
- Roles: `admin` (everything) and `viewer` (live, recordings, events; no settings).

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/info` (public) | | `{ name, version, setupRequired, demo, features: string[], siteId? }` |
| POST | `/api/auth/setup` (public, only while no admin exists) | `{ username, password }` | `{ token, user }` |
| POST | `/api/auth/login` (public) | `{ username, password, deviceName? }` | `{ token, user }` |
| POST | `/api/auth/pair` (public) | `{ code, deviceName? }` | `{ token, user }` (one-time pairing code from the web UI QR) |
| POST | `/api/auth/pairing-code` (admin) | `{ role? }` | `{ code, expiresAt, url }` url = `opencctv://pair?server=<baseUrl>&code=<code>` |
| GET | `/api/auth/me` | | `{ user }` |
| POST | `/api/auth/logout` | | `{ ok }` |
| GET/POST/PATCH/DELETE | `/api/users[/:id]` (admin) | `{ username, password?, role }` | `User[]` / `User` |

`User = { id, username, role, createdAt }`

## Cameras

```ts
type Camera = {
  id: string; name: string; brand: BrandId; group?: string; order: number; enabled: boolean;
  source: { kind: 'rtsp' | 'onvif' | 'tapo' | 'unifi' | 'http' | 'rtmp-push' | 'rtsp-push' | 'demo'; url: string /* password masked as *** */; subUrl?: string };
  recording: { mode: 'continuous' | 'motion' | 'off'; useSubstream: boolean };
  motion: { enabled: boolean; sensitivity: number /* 1-10 */; notify: boolean };
  capabilities: { audio: boolean; twoWayAudio: boolean; ptz: boolean; substream: boolean };
  status: { online: boolean; recording: boolean; lastSeen?: string; codec?: string; width?: number; height?: number; fps?: number; bitrateKbps?: number; error?: string };
  push?: { url: string } // only for *-push kinds: the URL the camera must publish to
}
type BrandId = 'tapo' | 'eufy' | 'unifi' | 'reolink' | 'hikvision' | 'dahua' | 'amcrest' | 'axis' | 'foscam' | 'ezviz' | 'imou' | 'annke' | 'wyze' | 'ubiquiti' | 'onvif' | 'generic' | 'demo'
```

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/brands` | | `Brand[]` = `{ id, name, kinds, fields: Field[], help: string, defaultPort? }`; `Field = { key, label, type: 'text'|'password'|'number'|'select', required, placeholder?, options? }` |
| GET | `/api/cameras` | | `Camera[]` |
| POST | `/api/cameras` | `{ name, brand, kind?, fields: Record<string,string> }` or `{ name, brand:'generic', url, subUrl? }` | `Camera` |
| PATCH | `/api/cameras/:id` | partial Camera (name, group, order, enabled, recording, motion, fields/url) | `Camera` |
| DELETE | `/api/cameras/:id` | | `{ ok }` |
| POST | `/api/cameras/test` | same as POST create | `{ ok, error?, codec?, width?, height?, audio?, snapshot?: base64jpeg }` |
| POST | `/api/cameras/reorder` | `{ ids: string[] }` | `{ ok }` |
| GET | `/api/cameras/:id/snapshot.jpg` | `?w=640` optional | JPEG (cached ≤ 2 s) |
| GET | `/api/cameras/:id/live.m3u8` | `?quality=hd\|sd` | HLS playlist (fMP4), child URLs carry the token |
| POST | `/api/cameras/:id/webrtc` | `{ sdp, quality? }` (offer) | `{ sdp }` (answer) |
| GET | `/api/cameras/:id/mjpeg` | | multipart MJPEG |
| GET | `/player/:id` | `?token=&quality=&muted=1` | minimal HTML page that plays the camera with WebRTC → MSE → HLS fallback, full-bleed, black background (used in a WebView for low latency and two-way audio) |
| POST | `/api/cameras/:id/ptz` | `{ action:'move', pan, tilt, zoom }` (-1..1) / `{ action:'stop' }` / `{ action:'preset', preset }` | `{ ok }` |
| GET | `/api/discover` | | `{ candidates: { host, port, brand?, name?, model?, onvif: boolean, rtsp: boolean, alreadyAdded: boolean }[] }` (ONVIF WS-Discovery + LAN port probe, ≤ 8 s) |
| POST | `/api/integrations/unifi/import` | `{ host, username, password, cameraIds? }` | `{ cameras: { id, name, model, added: boolean }[] }` |

## Recordings, timeline, events

```ts
type Recording = { id: string; cameraId: string; start: string; end: string; durationSec: number; sizeBytes: number;
  location: 'local' | 'remote' | 'both'; uploaded: boolean; motion: boolean; videoUrl: string; thumbUrl: string }
type MotionEvent = { id: string; cameraId: string; start: string; end?: string; score: number; snapshotUrl: string; recordingId?: string; offsetSec?: number }
```

| Method | Path | Query/Body | Response |
|---|---|---|---|
| GET | `/api/recordings` | `camera, from, to, limit, cursor` | `{ items: Recording[], nextCursor? }` |
| GET | `/api/recordings/:id/video.mp4` | | MP4 with HTTP Range support (local file or streamed from remote storage) |
| GET | `/api/recordings/:id/thumb.jpg` | | JPEG |
| DELETE | `/api/recordings/:id` (admin) | | `{ ok }` |
| GET | `/api/timeline` | `camera, day=YYYY-MM-DD, tz=Europe/Berlin` | `{ ranges: { start, end, recordingId }[], events: MotionEvent[], days: string[] /* days with footage */ }` |
| GET | `/api/events` | `camera?, from?, before?, limit` | `{ items: MotionEvent[], nextCursor? }` |
| GET | `/api/events/:id/snapshot.jpg` | | JPEG |
| POST | `/api/clips` | `{ cameraId, start, end }` | `{ url }` (MP4 export of a time range, for sharing) |

## Storage and retention

```ts
type StorageTarget = { id: string; type: 'local' | 'gdrive' | 's3' | 'ftp' | 'sftp' | 'smb' | 'webdav' | 'dropbox' | 'onedrive';
  name: string; enabled: boolean; config: Record<string, string> /* secrets masked as *** */; path: string /* folder inside the target */;
  retentionDays: number; status: { ok: boolean; lastUpload?: string; usedBytes?: number; queued: number; error?: string } }
```

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/storage` | | `{ local: { path, usedBytes, freeBytes, totalBytes, retentionDays, maxGB }, targets: StorageTarget[], types: { type, name, fields: Field[], help }[] }` |
| POST | `/api/storage/targets` | `{ type, name, config, path, retentionDays }` | `StorageTarget` |
| PATCH/DELETE | `/api/storage/targets/:id` | partial | `StorageTarget` / `{ ok }` |
| POST | `/api/storage/targets/test` | same as POST | `{ ok, error? }` |
| POST | `/api/storage/gdrive/start` | `{ name?, path? }` | `{ flowId, verificationUrl, userCode, expiresAt }` (OAuth device flow) or `{ flowId, authUrl }` (browser flow) |
| GET | `/api/storage/gdrive/:flowId` | | `{ status: 'pending' \| 'done' \| 'expired' \| 'error', target?: StorageTarget, error? }` |

## Settings, system, push, live updates

| Method | Path | Body | Response |
|---|---|---|---|
| GET/PATCH | `/api/settings` (admin for PATCH) | | `{ serverName, recording: { segmentSeconds, preMotionSec, postMotionSec }, retention: { localDays, maxLocalGB, deleteLocalAfterUpload: boolean }, motion: { defaultSensitivity }, notifications: { enabled, cooldownSec }, gateway: { url?, siteName?, connected: boolean, enabled: boolean } }` |
| GET | `/api/system` | | `{ version, uptimeSec, platform, cpuPercent, memBytes, disk: {...}, components: { go2rtc, ffmpeg, rclone }: { version, ok }, cameras: n, recordingsCount, recordingsBytes }` |
| GET | `/api/system/logs` (admin) | `?lines=200` | `{ lines: string[] }` |
| POST | `/api/push/register` | `{ expoPushToken, platform, cameras?: string[] }` | `{ ok }` |
| DELETE | `/api/push/register` | `{ expoPushToken }` | `{ ok }` |
| WS | `/api/ws?token=` | | server pushes `{ type: 'camera', camera }`, `{ type: 'motion', event }`, `{ type: 'recording', recording }`, `{ type: 'storage', target }` |

## Gateway (remote access without port forwarding)

Any OpenCCTV server can act as a gateway (e.g. deployed on a VPS/Coolify). Home servers ("sites") keep an outbound WebSocket tunnel to it; the app talks to the gateway and picks a site.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/sites` | | `{ items: { id, name, online, lastSeen, version, cameras }[] }` |
| POST | `/api/sites` (admin) | `{ name }` | `{ id, name, linkCode }` link code = what the home server enters |
| DELETE | `/api/sites/:id` (admin) | | `{ ok }` |
| POST | `/api/gateway/link` (admin, on the home server) | `{ url, linkCode }` | `{ ok, siteId }` |
| DELETE | `/api/gateway/link` (admin, on the home server) | | `{ ok }` |
| WS | `/api/gateway/tunnel` | site auth | internal tunnel protocol |
| ANY | `/s/:siteId/*` | | everything under `/api` and `/player` of that site, proxied through the tunnel (streaming, Range and WebSocket aware). Gateway users act as admin on the site. |

The app treats `https://gateway/s/<siteId>` as just another server base URL.

## Server extensions (implemented, v0.1)

Additions made while implementing the server. All are backwards compatible.

- Errors are `{ error: string }` with a non-2xx status. `503 { error: "Server is starting" }` while the server boots.
- `GET /api/info` also returns `demoLogin?: { username, password }` in demo mode. Through a gateway (`/s/<siteId>/api/info`) `setupRequired` is always `false`, `demoLogin` is omitted (logins there are gateway accounts) and `siteId` is set.
- `Recording.videoUrl`, `thumbUrl`, `MotionEvent.snapshotUrl` and the clip `url` are paths (`/api/...`). Prefix them with the server base URL (e.g. `https://gw/s/<siteId>`) and append `?token=`.
- `Camera.fields` (brand fields, secrets masked as `***`) for edit forms; sending `***` back in `PATCH` keeps the stored value. `Camera.createdAt`.
- `Camera.capabilities.ptzPresets?: { id, name }[]` (ONVIF presets; present when `ptz` is true). `GET /api/cameras/:id/ptz/presets` returns `{ presets: { token, name }[] }`.
- `Field` may carry `help?` and `default?`.
- `POST /api/cameras/test` also accepts `{ id, fields? }` to test an existing camera with changed fields.
- `GET /api/cameras/:id/ws?quality=` WebSocket: go2rtc player protocol (MSE / WebRTC signalling / HLS / MJPEG), used by `/player/:id`.
- `GET /api/cameras/:id/hls/<file>` child playlists and segments of `live.m3u8` (relative URLs, token appended).
- `POST /api/cameras/:id/webrtc` returns `{ type: 'answer', sdp }`.
- `/player/:id` query: `token`, `quality=hd|sd`, `muted=0|1` (default 1), `talk=1` (start with microphone), `mode=` (e.g. `mse`), `fit=cover`, `embed=app` (no overlays), `state=0`. Inside a React Native WebView it posts `{ type: 'state', state: 'loading'|'playing'|'error', mode?, error? }` and `{ type: 'talk', state: 'on'|'off'|'error', error? }` via `window.ReactNativeWebView.postMessage`, and exposes `window.OpenCCTV = { setMuted(b), setQuality('hd'|'sd'), talk(on): Promise<void> }` (talk reconnects over WebRTC with the microphone; needs a camera with a backchannel, e.g. Tapo with cloud password).
- `GET /api/timeline` also returns `day`, `tz`, `from`, `to`.
- `POST /api/clips` returns `{ url, expiresAt }`; clips are kept 24 h, max 1 h long, from local footage.
- `GET /api/recordings/:id` returns a single `Recording`.
- `GET /api/storage` also returns `gdrive: { deviceFlow, browserFlow, defaultBrowserClient }` and `rclone: boolean`. `StorageTarget.status.failed` counts uploads that gave up after 10 attempts. `types[].fields` drive the add form.
- `POST /api/storage/gdrive/start` body: `{ name?, path?, retentionDays?, mode?: 'device'|'browser', clientId?, clientSecret? }`. Device flow when the server has a TV client configured and no `clientId` is given, otherwise the browser flow (`{ flowId, authUrl, redirectUri, expiresAt }`; redirect URI is `<base>/api/storage/gdrive/callback`). Third option: create a `gdrive` target directly with `config: { token: '<rclone authorize "drive" JSON>' }`.
- `POST /api/storage/targets/:id/retention` (admin) runs remote and local retention now.
- `GET /api/settings` `gateway` also has `siteId?` and `error?`. `GET` is allowed for viewers, `PATCH` admin only.
- `GET /api/system` also returns `pushDevices`, `demo`.
- `POST /api/push/register` remembers the base URL the app used; push `data` = `{ type: 'motion', cameraId, eventId, start, server, serverName }`, title = camera name, body "Motion detected", `channelId: 'motion'`, `sound: 'default'`.
- WebSocket `/api/ws` first sends `{ type: 'hello', version, name }`; admins also receive `{ type: 'site', site }` on gateways.
- Pairing: `POST /api/auth/pairing-code` also returns `server` (the base URL in the link). A `viewer` pairing creates a dedicated viewer user for the device; an `admin` pairing signs the device in as the admin who created the code. Pairing codes are created on the server or gateway the app will talk to (not through `/s/<siteId>`).
- Gateway: `POST /api/sites` returns `{ id, name, linkCode, expiresAt }` (link codes are valid 24 h, single use); `POST /api/sites/:id/link-code` creates a new one; `GET /api/sites` items also have `linked`. `POST /api/gateway/claim` (public, used by the home server) `{ linkCode, name?, version? }` → `{ siteId, secret, name }`.
- Under `/s/<siteId>/`, `api/auth/login|pair|me|logout` are answered by the gateway itself (gateway accounts), `api/info` is public, everything else needs a gateway token and is forwarded with the gateway user's role.

### Tunnel protocol (`/api/gateway/tunnel`)

Binary WebSocket frames: `[type u8][stream u32 BE][payload]`. The home server connects with `Authorization: Bearer <site secret>` and `X-OpenCCTV-Site: <siteId>`. Types: 1 HELLO `{version,cameras,name}`, 2 REQ `{method,path,headers,role,user,base}`, 3 REQ_DATA, 4 REQ_END, 5 RES `{status,headers}`, 6 RES_DATA (≤ 64 KiB), 7 RES_END, 8 CANCEL, 9 CREDIT (u32 bytes; 512 KiB initial window per response stream), 10 WS_OPEN `{path,headers,protocols,role,user,base}`, 11 WS_ACCEPT, 12 WS_TEXT, 13 WS_BINARY, 14 WS_CLOSE `{code,reason}`, 15 PING, 16 PONG, 17 ERROR `{message}`. Gateway-initiated streams use odd ids.
