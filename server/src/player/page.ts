import videoRtcJs from "./video-rtc.js" with { type: "text" };

export const VIDEO_RTC_JS: string = videoRtcJs;

export function playerHtml(cameraId: string): string {
  const id = JSON.stringify(cameraId);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<title>OpenCCTV Player</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; width: 100%; background: #000; overflow: hidden; }
  opencctv-player { display: block; position: fixed; inset: 0; }
  opencctv-player video { width: 100%; height: 100%; object-fit: contain; background: #000; display: block; }
  #state { position: fixed; left: 12px; bottom: 10px; font: 500 11px/1.2 -apple-system, system-ui, sans-serif; color: rgba(255,255,255,.55); letter-spacing: .04em; text-transform: uppercase; pointer-events: none; }
  body.fill opencctv-player video { object-fit: cover; }
  body.nostate #state { display: none; }
</style>
</head>
<body>
<div id="state"></div>
<script type="module">
import { VideoRTC } from "./video-rtc.js";
const cameraId = ${id};
const params = new URLSearchParams(location.search);
const token = params.get("token") || "";
const embed = params.get("embed") === "app";
let quality = params.get("quality") === "sd" ? "sd" : "hd";
let talking = params.get("talk") === "1";
let muted = params.get("muted") !== "0";
if (params.get("fit") === "cover") document.body.classList.add("fill");
if (embed || params.get("state") === "0") document.body.classList.add("nostate");
const stateEl = document.getElementById("state");
const post = (msg) => {
  try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(msg)); } catch {}
  try { window.parent !== window && window.parent.postMessage({ source: "opencctv-player", ...msg }, "*"); } catch {}
};
let el;
const modeName = () => (el && el.pc ? "webrtc" : el && el.mseCodecs ? "mse" : el && el.video && el.video.src && el.video.src.startsWith("data:") ? "hls" : undefined);
class Player extends VideoRTC {
  oninit() {
    super.oninit();
    this.video.controls = false;
    this.video.muted = muted;
    this.video.addEventListener("playing", () => {
      stateEl.textContent = "";
      post({ type: "state", state: "playing", mode: modeName() });
    });
    this.video.addEventListener("error", () => post({ type: "state", state: "error", error: "playback error" }));
  }
  onconnect() {
    stateEl.textContent = "Connecting";
    post({ type: "state", state: "loading" });
    return super.onconnect();
  }
  ondisconnect() {
    stateEl.textContent = "Reconnecting";
    return super.ondisconnect();
  }
  onhls() {
    this.onmessage["hls"] = (msg) => {
      if (msg.type !== "hls") return;
      const base = new URL("../api/cameras/" + encodeURIComponent(cameraId) + "/hls/", location.href).toString();
      const playlist = msg.value.replace(/^hls\\/(.*)$/m, (_, rest) => base + rest + (token ? "&token=" + encodeURIComponent(token) : ""));
      this.video.src = "data:application/vnd.apple.mpegurl;base64," + btoa(playlist);
      this.play();
    };
    this.send({ type: "hls", value: this.codecs((type) => this.video.canPlayType(type)) });
  }
}
customElements.define("opencctv-player", Player);

function wsUrl() {
  const u = new URL("../api/cameras/" + encodeURIComponent(cameraId) + "/ws", location.href);
  u.searchParams.set("quality", quality);
  if (token) u.searchParams.set("token", token);
  return u.toString();
}

function connect() {
  el.mode = talking ? "webrtc" : (params.get("mode") || "webrtc,mse,hls,mjpeg");
  el.media = talking ? "video,audio,microphone" : "video,audio";
  el.src = wsUrl();
}

function reconnect() {
  if (el.ws || el.pc) el.ondisconnect();
  connect();
}

el = document.createElement("opencctv-player");
el.background = true;
el.visibilityCheck = false;
document.body.appendChild(el);
connect();

window.OpenCCTV = {
  setMuted(value) {
    muted = !!value;
    if (el.video) el.video.muted = muted;
  },
  setQuality(q) {
    const next = q === "sd" ? "sd" : "hd";
    if (next === quality) return;
    quality = next;
    reconnect();
  },
  async talk(on) {
    try {
      if (on && !talking) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("Microphone not available");
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
        probe.getTracks().forEach((t) => t.stop());
        talking = true;
        muted = false;
        reconnect();
      } else if (!on && talking) {
        talking = false;
        reconnect();
      }
      post({ type: "talk", state: talking ? "on" : "off" });
    } catch (e) {
      talking = false;
      post({ type: "talk", state: "error", error: String((e && e.message) || e) });
    }
  },
};

window.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.type === "mute") window.OpenCCTV.setMuted(!!d.value);
  if (d.type === "quality") window.OpenCCTV.setQuality(d.value);
  if (d.type === "talk") window.OpenCCTV.talk(!!d.value);
});
</script>
</body>
</html>`;
}
