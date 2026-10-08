import { useEffect } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';

import { useConnection } from './connection';
import { invalidate, setQueryData } from './query';
import type { Camera, WsMessage } from './types';
import { wsUrl } from './url';

type MotionState = { last: Record<string, number>; connected: boolean; bump: (cameraId: string, at: number) => void };

export const useMotion = create<MotionState>()((set) => ({
  last: {},
  connected: false,
  bump: (cameraId, at) => set((s) => ({ last: { ...s.last, [cameraId]: Math.max(at, s.last[cameraId] ?? 0) } })),
}));

export const MOTION_ACTIVE_MS = 20000;

export function useLiveUpdates() {
  const { server, token, scope } = useConnection();
  const baseUrl = server?.baseUrl;

  useEffect(() => {
    if (!baseUrl || !token) return;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let closed = false;

    const connect = () => {
      if (closed || ws) return;
      const socket = new WebSocket(wsUrl(baseUrl, token));
      ws = socket;
      socket.onopen = () => {
        attempts = 0;
        useMotion.setState({ connected: true });
      };
      socket.onmessage = (ev) => {
        let msg: WsMessage;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg.type === 'camera' && msg.camera) {
          setQueryData<Camera[]>(`${scope}cameras`, (prev) => {
            if (!prev) return prev;
            const i = prev.findIndex((c) => c.id === msg.camera.id);
            if (i < 0) return [...prev, msg.camera];
            const next = prev.slice();
            next[i] = msg.camera;
            return next;
          });
        } else if (msg.type === 'motion' && msg.event) {
          const at = Date.parse(msg.event.start) || Date.now();
          useMotion.getState().bump(msg.event.cameraId, Math.max(at, Date.now() - 1000));
          invalidate(`${scope}events:`);
          invalidate(`${scope}timeline:${msg.event.cameraId}`);
        } else if (msg.type === 'recording') {
          invalidate(`${scope}timeline:${msg.recording.cameraId}`);
        } else if (msg.type === 'storage') {
          invalidate(`${scope}storage`);
        }
      };
      socket.onclose = () => {
        ws = null;
        useMotion.setState({ connected: false });
        if (closed) return;
        attempts++;
        retry = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(attempts, 5)));
      };
      socket.onerror = () => socket.close();
    };

    const disconnect = () => {
      if (retry) clearTimeout(retry);
      retry = null;
      const s = ws;
      ws = null;
      s?.close();
    };

    connect();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        closed = false;
        connect();
        invalidate(`${scope}cameras`);
      } else if (state === 'background') {
        closed = true;
        disconnect();
      }
    });
    return () => {
      closed = true;
      sub.remove();
      disconnect();
    };
  }, [baseUrl, token, scope]);
}
