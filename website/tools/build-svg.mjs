// Inlines the diagram SVGs from tools/partials into the pages, with translated labels.
// Idempotent: replaces everything between <!--SVG:name--> and <!--/SVG-->.
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const S = {
  en: {
    flowTitle: 'Cameras stream to the OpenCCTV server, which records them and uploads to your storage; apps and browsers connect to the server over LAN, gateway or VPN',
    cameras: 'YOUR CAMERAS', server: 'YOUR SERVER', storage: 'YOUR STORAGE', devices: 'YOUR DEVICES',
    pushCam: 'Doorbell or dashcam', pushCamSub: 'pushes RTMP to the server',
    go2rtc: 'live view: WebRTC, HLS, RTSP', ffmpeg: 'recording and motion detection', rclone: 'upload and retention', webui: 'API, pairing, gateway · :8080',
    go2rtcShort: 'live view: WebRTC, HLS', ffmpegShort: 'recording, motion', rcloneShort: 'upload, retention',
    localDisk: 'Local disk', days7: '7 days', days30: '30 days', days90: '90 days',
    via: 'via LAN, gateway or VPN', apps: 'iPhone and Android', appsShort: 'iPhone, Android', browser: 'Browser',
    gwTitle: 'The home server opens an outbound tunnel to a gateway on a VPS; the app connects to the gateway over HTTPS, so no ports are opened at home',
    gwName: 'OpenCCTV gateway', gwWhere: 'your VPS or Coolify', home: 'YOUR HOME NETWORK', router: 'no open ports',
    homeServer: 'OpenCCTV server', homeServerSub: 'records, uploads, stays home', app: 'OpenCCTV app', appWhere: 'on LTE, anywhere', tunnel: 'outbound tunnel (wss)',
  },
  de: {
    flowTitle: 'Kameras streamen zum OpenCCTV-Server, der aufzeichnet und in deinen Speicher hochlädt; Apps und Browser verbinden sich per LAN, Gateway oder VPN mit dem Server',
    cameras: 'DEINE KAMERAS', server: 'DEIN SERVER', storage: 'DEIN SPEICHER', devices: 'DEINE GERÄTE',
    pushCam: 'Türklingel oder Dashcam', pushCamSub: 'sendet RTMP an den Server',
    go2rtc: 'Livebild: WebRTC, HLS, RTSP', ffmpeg: 'Aufnahme und Bewegungserkennung', rclone: 'Upload und Aufbewahrung', webui: 'API, Kopplung, Gateway · :8080',
    go2rtcShort: 'Livebild: WebRTC, HLS', ffmpegShort: 'Aufnahme, Bewegung', rcloneShort: 'Upload, Aufbewahrung',
    localDisk: 'Lokale Platte', days7: '7 Tage', days30: '30 Tage', days90: '90 Tage',
    via: 'per LAN, Gateway oder VPN', apps: 'iPhone und Android', appsShort: 'iPhone, Android', browser: 'Browser',
    gwTitle: 'Der Server zu Hause baut einen ausgehenden Tunnel zu einem Gateway auf einem VPS auf; die App verbindet sich per HTTPS mit dem Gateway, zu Hause wird kein Port geöffnet',
    gwName: 'OpenCCTV-Gateway', gwWhere: 'dein VPS oder Coolify', home: 'DEIN HEIMNETZ', router: 'keine offenen Ports',
    homeServer: 'OpenCCTV-Server', homeServerSub: 'nimmt auf, lädt hoch, bleibt zu Hause', app: 'OpenCCTV-App', appWhere: 'unterwegs, per LTE', tunnel: 'ausgehender Tunnel (wss)',
  },
};
const pages = { 'public/index.html': 'en', 'public/de/index.html': 'de' };
for (const [file, lang] of Object.entries(pages)) {
  let html;
  try { html = readFileSync(root + file, 'utf8'); } catch { continue; }
  html = html.replace(/<!--SVG:([\w-]+)-->[\s\S]*?<!--\/SVG-->/g, (_, name) => {
    const svg = readFileSync(`${root}tools/partials/${name}.svg`, 'utf8').trim()
      .replace(/\{\{(\w+)\}\}/g, (m, k) => { if (!(k in S[lang])) throw new Error(`missing ${k}`); return S[lang][k]; });
    return `<!--SVG:${name}-->${svg}<!--/SVG-->`;
  });
  writeFileSync(root + file, html);
  console.log('inlined svgs into', file);
}
