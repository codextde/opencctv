import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import { liveSocket, type SocketState } from './ws';
import type { Camera, Info, User, WsMessage } from './types';

interface AppState {
  info: Info;
  user: User;
  isAdmin: boolean;
  serverName: string;
  setServerName: (n: string) => void;
  cameras: Camera[] | null;
  camerasError: string | null;
  refreshCameras: () => Promise<void>;
  setCameras: (fn: (prev: Camera[]) => Camera[]) => void;
  cameraById: (id: string | undefined | null) => Camera | undefined;
  socket: SocketState;
  logout: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
}

/** Subscribe to live websocket messages for the lifetime of a component. */
export function useLive(fn: (msg: WsMessage) => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => liveSocket.subscribe((m) => ref.current(m)), []);
}

export function AppProvider({
  info,
  user,
  onLogout,
  children,
}: {
  info: Info;
  user: User;
  onLogout: () => void;
  children: ReactNode;
}) {
  const [cameras, setCamerasState] = useState<Camera[] | null>(null);
  const [camerasError, setCamerasError] = useState<string | null>(null);
  const [socket, setSocket] = useState<SocketState>(liveSocket.state);
  const [serverName, setServerName] = useState(info.name);

  const refreshCameras = useCallback(async () => {
    try {
      const list = await api.cameras();
      setCamerasState([...list].sort((a, b) => a.order - b.order));
      setCamerasError(null);
    } catch (e) {
      setCamerasError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refreshCameras();
    liveSocket.start();
    const offState = liveSocket.onState(setSocket);
    setSocket(liveSocket.state);
    const offMsg = liveSocket.subscribe((m) => {
      if (m.type === 'camera') {
        setCamerasState((prev) => {
          if (!prev) return prev;
          const i = prev.findIndex((c) => c.id === m.camera.id);
          if (i < 0) return [...prev, m.camera].sort((a, b) => a.order - b.order);
          const next = prev.slice();
          next[i] = m.camera;
          return next;
        });
      }
    });
    return () => {
      offState();
      offMsg();
      liveSocket.stop();
    };
  }, [refreshCameras]);

  // Refresh when the tab comes back after a while (socket may have missed updates).
  useEffect(() => {
    let hiddenAt = 0;
    const on = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 30_000) void refreshCameras();
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [refreshCameras]);

  const value = useMemo<AppState>(
    () => ({
      info,
      user,
      isAdmin: user.role === 'admin',
      serverName,
      setServerName,
      cameras,
      camerasError,
      refreshCameras,
      setCameras: (fn) => setCamerasState((prev) => fn(prev ?? [])),
      cameraById: (id) => (id ? cameras?.find((c) => c.id === id) : undefined),
      socket,
      logout: onLogout,
    }),
    [info, user, serverName, cameras, camerasError, refreshCameras, socket, onLogout],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Small data-loading hook: `const { data, error, loading, reload } = useAsync(() => api.x(), [deps])`. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const reload = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    try {
      const v = await fnRef.current();
      if (id === seq.current) {
        setData(v);
        setError(null);
      }
    } catch (e) {
      if (id === seq.current) setError((e as Error).message);
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, setData, error, loading, reload };
}
