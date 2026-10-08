import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { PermissionsAndroid, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

export type PlayerState = { state: 'loading' | 'playing' | 'error'; mode?: string; error?: string };

export type WebPlayerHandle = { talk: (on: boolean) => Promise<boolean>; setMuted: (muted: boolean) => void };

type Props = {
  uri: string;
  muted: boolean;
  style?: StyleProp<ViewStyle>;
  onState?: (s: PlayerState) => void;
  onTalk?: (state: 'on' | 'off' | 'error', error?: string) => void;
  onPlaying?: () => void;
};

const PROBE = `
(function () {
  if (window.__occtvProbe) return;
  window.__occtvProbe = true;
  var last = '';
  var lastTime = -1;
  function send(o) { try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch (e) {} }
  function check() {
    var v = document.querySelector('video');
    var state = 'loading';
    if (v) {
      var moving = v.currentTime !== lastTime && v.currentTime > 0;
      lastTime = v.currentTime;
      if (!v.paused && v.readyState >= 2 && (moving || v.currentTime > 0)) state = 'playing';
      if (v.error) state = 'error';
      if (v.paused && v.readyState >= 2) { try { v.play(); } catch (e) {} }
    }
    if (state !== last) { last = state; send({ type: 'probe', state: state }); }
  }
  setInterval(check, 500);
  document.documentElement.style.background = '#000';
  if (document.body) document.body.style.background = '#000';
  var style = document.createElement('style');
  style.textContent = 'html,body{background:#000!important;margin:0;overflow:hidden}video{object-fit:contain!important;width:100vw!important;height:100vh!important;background:#000}';
  document.head && document.head.appendChild(style);
})();
true;
`;

export const WebRtcPlayer = forwardRef<WebPlayerHandle, Props>(function WebRtcPlayer({ uri, muted, style, onState, onTalk, onPlaying }, ref) {
  const web = useRef<WebView>(null);
  const reported = useRef<string>('');

  const run = (js: string) => web.current?.injectJavaScript(`(function(){try{${js}}catch(e){}})();true;`);

  const setMuted = (m: boolean) =>
    run(`window.dispatchEvent(new MessageEvent('message',{data:{type:'mute',value:${m}}})); document.querySelectorAll('video').forEach(function(v){v.muted=${m}; if(!${m}){v.volume=1; try{v.play();}catch(e){}}});`);

  const setMic = (on: boolean) =>
    run(
      `var p=document.querySelector('opencctv-player'); var pc=p&&p.pc; var n=0; if(pc){pc.getSenders().forEach(function(s){if(s.track&&s.track.kind==='audio'){s.track.enabled=${on};n++;}});} window.ReactNativeWebView.postMessage(JSON.stringify({type:'talk',state:n?'${on ? 'on' : 'off'}':'error',error:n?undefined:'unsupported'}));`,
    );

  useImperativeHandle(ref, () => ({
    setMuted,
    talk: async (on: boolean) => {
      if (on && Platform.OS === 'android') {
        const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        if (res !== PermissionsAndroid.RESULTS.GRANTED) return false;
      }
      setMic(on);
      return true;
    },
  }));

  useEffect(() => {
    setMuted(muted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted]);

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: { type?: string; state?: string; mode?: string; error?: string };
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === 'playing') msg = { type: 'state', state: 'playing', mode: msg.mode };
    else if (msg.type === 'disconnected') msg = { type: 'state', state: 'loading' };
    if (msg.type === 'state' || msg.type === 'probe') {
      const state = msg.state === 'playing' ? 'playing' : msg.state === 'error' ? 'error' : 'loading';
      const key = `${state}:${msg.mode ?? ''}`;
      if (msg.type === 'probe' && reported.current.startsWith('playing') && state === 'loading') return;
      if (key === reported.current) return;
      reported.current = key;
      onState?.({ state, mode: msg.mode, error: msg.error });
      if (state === 'playing') {
        setMuted(muted);
        onPlaying?.();
      }
    } else if (msg.type === 'talk') {
      onTalk?.(msg.state === 'on' ? 'on' : msg.state === 'off' ? 'off' : 'error', msg.error);
    }
  };

  return (
    <View style={[styles.root, style]} pointerEvents="none">
      <WebView
        ref={web}
        source={{ uri }}
        style={styles.web}
        containerStyle={styles.web}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsPictureInPictureMediaPlayback
        allowsAirPlayForMediaPlayback
        mediaCapturePermissionGrantType="grant"
        injectedJavaScript={PROBE}
        injectedJavaScriptForMainFrameOnly
        onMessage={onMessage}
        onError={(e) => onState?.({ state: 'error', error: e.nativeEvent.description })}
        onHttpError={(e) => onState?.({ state: 'error', error: `HTTP ${e.nativeEvent.statusCode}` })}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        setSupportMultipleWindows={false}
        allowsBackForwardNavigationGestures={false}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        mixedContentMode="always"
        androidLayerType="hardware"
        webviewDebuggingEnabled={__DEV__}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  root: { backgroundColor: '#000', overflow: 'hidden' },
  web: { flex: 1, backgroundColor: '#000' },
});
