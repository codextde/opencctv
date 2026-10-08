# API requests from the app

Small additions the mobile app (`app/`) would like. Everything here is optional: the app already works without it and falls back gracefully.

## 1. `/player/:id` embedding hooks (low-latency view + two-way audio)

The app shows `/player/:id?token=&quality=hd|sd&muted=1&embed=app` in a WebView.

- When running inside the app (`window.ReactNativeWebView` exists), please post state changes:
  `window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'state', state: 'loading' | 'playing' | 'error', mode: 'webrtc' | 'mse' | 'hls', error?: string }))`
  The app currently also polls the first `<video>` element (`!paused && readyState >= 2`) as a fallback, so this is a nice-to-have.
- Please expose a tiny control object:
  ```js
  window.OpenCCTV = {
    setMuted(muted: boolean): void,
    talk(on: boolean): Promise<void>, // push-to-talk: getUserMedia({audio:true}) and send the track over the WebRTC peer (sendrecv audio), stop/disable it on false
    setQuality(q: 'hd' | 'sd'): void,
  }
  ```
  and post `{ type: 'talk', state: 'on' | 'off' | 'error', error?: string }` back.
- With `embed=app`: no on-page controls/overlays (the app draws its own), `object-fit: contain`, black background.

## 2. PTZ presets

`Camera.capabilities.ptzPresets?: { id: string; name: string }[]` (from ONVIF `GetPresets`). The app shows them as buttons and calls `POST /api/cameras/:id/ptz { action: 'preset', preset: id }`. Without it the app shows nothing for presets.

## 3. Push payload

For `/api/push/register` notifications, please put this into the Expo push message `data` so tapping opens the right recording:
`{ cameraId, eventId, start /* ISO */, server /* public base URL the app used, e.g. https://gw/s/<siteId>, if known */ }`
Title: camera name, body: e.g. "Motion detected", `channelId: 'motion'` (the app creates this Android channel), `sound: 'default'`. Optional `mutableContent` + `richContent.image` with the event snapshot URL.

## 4. Field help text and defaults

`Field` could carry optional `help?: string` and `default?: string` (the app renders them under the input if present).

## 5. Demo loop boundary in WebRTC (observation)

On the iOS Simulator the full-screen `/player/:id?embed=app` (WebRTC) shows black for roughly 1 to 2 seconds every time a demo clip loops (`ffmpeg -stream_loop -1 -c copy`), e.g. every 13 s for `backyard.mp4`. Recordings and HLS are not affected. Generating continuous timestamps for the loop (for example `-fflags +genpts` with `-re`, or re-muxing the clips once into a long file) would avoid the gap on the public demo. App side nothing to do.

## 6. `Content-Length` on `/api/recordings/:id/video.mp4`

`serveFile` sets `content-length` for 206/200, but the response arrives as `Transfer-Encoding: chunked` without `Content-Length` (checked with `curl -D - -H 'Range: bytes=0-' …/video.mp4`; probably dropped where security headers are added to the response). AVPlayer on iOS copes, but on the Android emulator ExoPlayer stalls on the first frame of recordings while HLS live plays fine. Please keep `Content-Length` on range responses (and on `HEAD`), so progressive MP4 playback and seeking work reliably on Android.
