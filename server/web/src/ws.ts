import { isMock, wsUrl } from './api';
import { mockSocket } from './mock';
import type { WsMessage } from './types';

export type SocketState = 'connecting' | 'open' | 'closed';
type Listener = (msg: WsMessage) => void;

/** Live-update socket with exponential backoff reconnect. */
class LiveSocket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private stateListeners = new Set<(s: SocketState) => void>();
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopMock: (() => void) | null = null;
  private active = false;
  state: SocketState = 'closed';

  start(): void {
    if (this.active) return;
    this.active = true;
    this.connect();
  }

  stop(): void {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.stopMock?.();
    this.stopMock = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.setState('closed');
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onState(fn: (s: SocketState) => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  private setState(s: SocketState): void {
    this.state = s;
    this.stateListeners.forEach((l) => l(s));
  }

  private emit(msg: WsMessage): void {
    this.listeners.forEach((l) => {
      try {
        l(msg);
      } catch (e) {
        console.error(e);
      }
    });
  }

  private connect(): void {
    if (!this.active) return;
    if (isMock()) {
      this.setState('open');
      this.stopMock = mockSocket((m) => this.emit(m));
      return;
    }
    this.setState('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl('/api/ws'));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.setState('open');
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      try {
        const msg = JSON.parse(ev.data) as WsMessage;
        if (msg && typeof msg === 'object' && 'type' in msg) this.emit(msg);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.setState('closed');
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect(): void {
    if (!this.active) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.attempt) * (0.75 + Math.random() * 0.5);
    this.attempt++;
    this.timer = setTimeout(() => this.connect(), delay);
  }
}

export const liveSocket = new LiveSocket();
