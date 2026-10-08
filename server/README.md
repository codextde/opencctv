# OpenCCTV Server

Free, open-source camera server, NVR, cloud recorder and remote-access gateway. One small binary (or Docker image) that connects to your IP cameras, records them 24/7 or on motion, uploads recordings to the storage of your choice, cleans up old footage automatically and serves live video and recordings to the OpenCCTV app and the built-in web UI.

MIT licensed, made by Codext GmbH.

- Cameras: TP-Link Tapo, Eufy (RTSP models), UniFi Protect, Reolink, Hikvision, Dahua, Amcrest, Imou, Annke, Axis, Foscam, EZVIZ, Wyze (RTSP firmware), any ONVIF / RTSP / HTTP-MJPEG camera, plus cameras that push RTSP or RTMP.
- Recording: continuous or motion-only, MP4 segments, thumbnails, timeline, motion events with snapshots, clip export.
- Storage: local disk plus Google Drive, S3 compatible (AWS, R2, B2, Wasabi, MinIO), FTP/FTPS, SFTP, SMB, WebDAV/Nextcloud, Dropbox, OneDrive. Retention by days (local and remote) and by disk size.
- Live: WebRTC, MSE, HLS, MJPEG, snapshots, PTZ (ONVIF), two-way audio where the camera supports it.
- Remote access: any instance can be a gateway; home servers keep an outbound tunnel, so the app works anywhere without port forwarding.
- Push notifications to the app (Expo push, free).

Under the hood it manages [go2rtc](https://github.com/AlexxIT/go2rtc) (camera protocols), [ffmpeg](https://ffmpeg.org) (recording, motion detection) and [rclone](https://rclone.org) (storage). The server finds them on `PATH`, next to the executable or in `<data>/bin`, and downloads missing ones on first start. The Docker image ships all three.

## Install

Default port is `8080`. Open `http://<server-ip>:8080`, create the first admin account, then add cameras. Use "Pair phone" in the web UI to connect the app with a QR code.

### Linux

```sh
curl -fsSL -o opencctv https://github.com/codextde/opencctv/releases/latest/download/opencctv-linux-x64   # or -linux-arm64
chmod +x opencctv
sudo apt install ffmpeg          # optional, downloaded automatically otherwise
./opencctv                       # data in ~/.opencctv
sudo ./opencctv service install  # systemd unit, starts at boot (without sudo: user unit)
```

### macOS

```sh
curl -fsSL -o opencctv https://github.com/codextde/opencctv/releases/latest/download/opencctv-darwin-arm64   # or -darwin-x64
chmod +x opencctv && xattr -d com.apple.quarantine opencctv 2>/dev/null
brew install ffmpeg              # recommended on Apple Silicon
./opencctv
./opencctv service install       # launchd agent, starts at login
```

### Windows

Download `opencctv-windows-x64.exe` from the releases page and run it. Data lives in `%APPDATA%\OpenCCTV`. `opencctv-windows-x64.exe service install` registers a scheduled task that starts at logon. Allow the app through the firewall when asked.

### Docker

```sh
docker run -d --name opencctv --restart unless-stopped --network host \
  -v ./opencctv-data:/data ghcr.io/codextde/opencctv:latest
```

Or use [`docker-compose.yml`](../docker-compose.yml) in the repository root (`docker compose up -d`). Host networking is needed for automatic camera discovery (ONVIF multicast) and gives the best WebRTC results. Without it, map `8080/tcp`, `8555/tcp+udp` (WebRTC) and, only for push cameras, `8554/tcp` (RTSP) and `1935/tcp` (RTMP).

Build the image yourself from the repository root: `docker build -f server/Dockerfile -t opencctv .`

### Coolify / reverse proxy

Any Docker host works: deploy the image `ghcr.io/codextde/opencctv` (or build `server/Dockerfile` with the repository root as build context), expose port 8080 and mount a persistent volume at `/data`.

On Coolify the ready-made stack is [`deploy/coolify/docker-compose.yml`](../deploy/coolify/docker-compose.yml): create a resource from this repository with the Docker Compose build pack, Base Directory `/deploy/coolify`, Docker Compose Location `/docker-compose.yml`. Set `OPENCCTV_ADMIN_PASSWORD` (required) and the domain of the `opencctv` service (port 8080). It runs in demo mode by default; set `OPENCCTV_DEMO=0` for a plain server or gateway.

The server honours `X-Forwarded-Proto`, `X-Forwarded-Host` and `X-Forwarded-Prefix`; set `OPENCCTV_PUBLIC_URL=https://cams.example.com` to force the public URL used in pairing links and OAuth redirects. WebSockets must be allowed through the proxy (Traefik does this by default). WebRTC media does not pass through HTTP proxies: open `8555/tcp+udp` and set `OPENCCTV_WEBRTC_CANDIDATES=<public-ip>:8555`, otherwise the players fall back to MSE/HLS over HTTPS automatically.

Public demo setup: `OPENCCTV_DEMO=1`, `OPENCCTV_ADMIN_USER`/`OPENCCTV_ADMIN_PASSWORD` for yourself. Demo mode loops the bundled clips (`demo/media`, stream copy, near-zero CPU), records them with 1 day / 5 GB local retention (changeable in Settings) and adds a read-only `demo` / `demo` account that is shown on the login page. Without `OPENCCTV_ADMIN_*` the first visitor gets the admin setup screen, so always set them on a public instance.

## Command line

```
opencctv [serve] [--data DIR] [--port PORT] [--demo]
opencctv service install|uninstall
opencctv reset-password <username> [new-password]   # prints a random password if none is given
opencctv healthcheck [--port PORT]                  # exit code 0 when the local server answers (used by Docker)
opencctv --version
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `OPENCCTV_DATA` | `~/.opencctv`, `%APPDATA%\OpenCCTV`, `/data` in Docker | Database, recordings, config |
| `OPENCCTV_PORT` | `8080` | HTTP port (web UI, API, player) |
| `OPENCCTV_HOST` | `0.0.0.0` | Bind address |
| `OPENCCTV_PUBLIC_URL` | | Public base URL behind a reverse proxy |
| `OPENCCTV_ADMIN_USER` / `OPENCCTV_ADMIN_PASSWORD` | | Create this admin on start if it does not exist yet (skips the setup screen). Changing the variable later does not change the password; use `reset-password` |
| `OPENCCTV_RTSP_PORT` | `8554` | RTSP port for push cameras (only opened when a push camera exists or `OPENCCTV_RTSP_PUBLIC=1`) |
| `OPENCCTV_RTMP_PORT` | `1935` | RTMP port for RTMP push cameras |
| `OPENCCTV_WEBRTC_PORT` | `8555` | WebRTC media port (tcp+udp) |
| `OPENCCTV_WEBRTC_CANDIDATES` | `stun:8555` | Comma separated `host:port` candidates for WebRTC behind NAT |
| `OPENCCTV_WEBRTC_DISABLE` | | `1` disables WebRTC |
| `OPENCCTV_GOOGLE_CLIENT_ID` / `_SECRET` | | Google OAuth client of type "TVs and Limited Input devices" for one-click Google Drive |
| `OPENCCTV_GOOGLE_WEB_CLIENT_ID` / `_SECRET` | | Optional default Web client for the browser OAuth flow |
| `OPENCCTV_DEMO` | | `1` enables demo mode |
| `OPENCCTV_DEMO_DIR` | `demo/media` | Folder with demo `.mp4` clips |
| `OPENCCTV_DEMO_URLS` | | `Name|https://...mp4,Name 2|https://...` clips downloaded into `<data>/demo` |
| `OPENCCTV_FFMPEG`, `OPENCCTV_GO2RTC`, `OPENCCTV_RCLONE` | | Explicit binary paths |
| `OPENCCTV_NO_DOWNLOAD` | | `1` never downloads binaries |
| `OPENCCTV_DEBUG` | | `1` enables debug logs |
| `OPENCCTV_QUIET` | | `1` prints only errors to stdout (System > Logs still shows everything) |

## Adding cameras

The "Add camera" wizard has presets per brand, a "Test" button that shows a snapshot, codec and resolution before saving, network discovery (ONVIF WS-Discovery and a quick scan of the local /24) and a UniFi Protect import. Use the sub stream for motion detection and the tile grid; the main stream is recorded.

| Brand | Setup | Stream URL used |
|---|---|---|
| TP-Link Tapo | See below. | `rtsp://user:pass@IP:554/stream1`, sub `stream2` |
| Eufy | Eufy app > camera > Settings > Storage > NAS (RTSP), set credentials (HomeBase 3: Storage > NAS (RTSP)). Battery cameras drain faster with RTSP on. | `rtsp://user:pass@IP/live0` |
| UniFi Protect | Use "UniFi Protect import" with a local Protect account: it logs in, enables RTSP and adds every camera. Manually: Protect > camera > Settings > Advanced > RTSP, copy the alias. | `rtspx://CONSOLE:7441/ALIAS` |
| Reolink | Enable RTSP and ONVIF under Network > Advanced > Server Settings. | `/h264Preview_01_main`, `_sub` |
| Hikvision | Enable ONVIF for PTZ. | `/Streaming/Channels/101`, `102` |
| Dahua, Amcrest, Imou, Annke | Imou: password is the safety code on the label. | `/cam/realmonitor?channel=1&subtype=0` / `1` |
| Axis | | `/axis-media/media.amp` |
| Foscam | RTSP on port 88. | `:88/videoMain`, `videoSub` |
| EZVIZ | Enable RTSP / LAN live view in the app. User `admin`, password = verification code. | `/h264/ch1/main/av_stream` |
| Wyze | Official RTSP firmware (or wz_mini_hacks), enable RTSP in the app. | `/live` |
| Ubiquiti standalone | Cameras not adopted by Protect. | `/s0`, `/s1` |
| ONVIF | Any ONVIF camera, stream discovered automatically. | `onvif://user:pass@IP:port` |
| Other | Any RTSP/RTSPS/HTTP MJPEG/JPEG URL. | as entered |
| Push (RTSP/RTMP) | Save a camera of type "Camera pushes RTSP/RTMP"; the UI shows the URL to configure on the camera, e.g. `rtsp://opencctv:<secret>@SERVER:8554/<key>`. | |

### TP-Link Tapo

Tapo cameras (C100, C200, C210, C310, C320WS, C500, C520WS, TC60, ...) need a local "camera account" for RTSP/ONVIF:

1. Tapo app > tap the camera > gear icon (Settings) > Advanced Settings > Camera Account.
2. Create a username and password. This is a separate local account, not your TP-Link ID.
3. Give the camera a fixed IP (DHCP reservation in your router) and note it (Tapo app > Settings > Device Info).
4. In OpenCCTV: Add camera > TP-Link Tapo, enter the IP and the camera account. Test, then save.
5. Optional: enter your TP-Link cloud password (the TP-Link ID password) to enable two-way audio. PTZ models get pan/tilt and presets over ONVIF (port 2020) automatically.

Most battery-powered Tapo models (e.g. C400, C420) do not offer RTSP/ONVIF and cannot be added.

Camera passwords are stored in the server database (`<data>/opencctv.db`, file mode 600) and are never returned by the API.

## Storage and retention

Settings > Retention: keep local recordings for N days, cap local usage at N GB (oldest first), and optionally delete local files once every enabled destination has a copy. Storage > Add destination adds remote copies; each destination has its own retention ("keep N days"), applied hourly with `rclone delete --min-age` inside the destination folder only. Recordings that exist only remotely still play in the app (streamed through the server with Range support).

Motion-only recording keeps segments that overlap a motion event (plus the pre/post motion padding) and deletes the rest.

### Google Drive

OpenCCTV only asks for the `drive.file` scope: it can see and manage the files it created, nothing else.

1. **One click (device code)**: official release binaries and the Docker image include the OpenCCTV Google client, so "Connect Google Drive" just shows a code; open google.com/device on any device, enter it, done. If you build OpenCCTV yourself, set `OPENCCTV_GOOGLE_CLIENT_ID` / `OPENCCTV_GOOGLE_CLIENT_SECRET` (a Google Cloud OAuth client of type "TVs and Limited Input devices" with the Drive API enabled), or pass `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` to `bun run build`.
2. **Your own OAuth client (browser)**: create an OAuth client of type "Web application", add `https://<your-server>/api/storage/gdrive/callback` as redirect URI, paste client id and secret into the dialog and sign in.
3. **Paste an rclone token**: run `rclone authorize "drive"` on any computer with a browser and paste the printed JSON.

Dropbox and OneDrive use option 3 (`rclone authorize "dropbox"` / `"onedrive"`).

## Remote access (gateway)

1. Run an OpenCCTV instance with a public HTTPS address (VPS, Coolify). It needs no cameras.
2. On the gateway: Gateway > Sites > Add site. Copy the link code.
3. On the home server: Gateway > Connect to a gateway, enter the gateway URL and the link code.

The home server keeps an outbound WebSocket to the gateway (auto reconnect). In the app, add `https://<gateway>/s/<siteId>` as server (or sign in to the gateway and pick the site). HLS, MSE, MJPEG, snapshots, recordings with Range and WebRTC signalling are carried through the tunnel. Users of the gateway act on the site with their gateway role. Every gateway account can reach every linked site, so only create gateway accounts for people who may see all sites, and never link a private site to a public demo gateway.

## Development

```sh
cd server
bun install
bun run dev                     # http://localhost:8080
OPENCCTV_DEMO=1 OPENCCTV_DATA=/tmp/occ bun src/index.ts --port 18080
bun test && bun run typecheck
bun run build                   # all release binaries into dist/ (web UI embedded)
bun run scripts/build.ts darwin-arm64
```

Source layout: `src/http` (API, routing, gateway proxy), `src/auth.ts`, `src/cameras.ts` + `src/brands.ts`, `src/go2rtc.ts`, `src/recorder.ts`, `src/motion.ts`, `src/storage` (rclone, Google Drive), `src/retention.ts`, `src/gateway` (tunnel protocol), `src/onvif.ts`, `src/discovery.ts`, `src/unifi.ts`, `src/push.ts`, `src/deps.ts`, `src/player` (WebView player), `web/` (admin UI). The API contract is in [`docs/API.md`](../docs/API.md).
