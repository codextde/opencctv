import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

type Entry = {
  data?: unknown;
  error?: unknown;
  updatedAt: number;
  loading: boolean;
  promise?: Promise<void>;
  fetcher?: () => Promise<unknown>;
  listeners: Set<() => void>;
  version: number;
  gen: number;
};

const cache = new Map<string, Entry>();

function entry(key: string): Entry {
  let e = cache.get(key);
  if (!e) {
    e = { updatedAt: 0, loading: false, listeners: new Set(), version: 0, gen: 0 };
    cache.set(key, e);
  }
  return e;
}

function emit(e: Entry) {
  e.version++;
  for (const l of e.listeners) l();
}

export function fetchQuery<T>(key: string, fetcher: () => Promise<T>): Promise<void> {
  const e = entry(key);
  e.fetcher = fetcher;
  if (e.promise) return e.promise;
  const gen = e.gen;
  e.loading = true;
  emit(e);
  e.promise = fetcher()
    .then(
      (data) => {
        if (e.gen !== gen) return;
        e.data = data;
        e.error = undefined;
        e.updatedAt = Date.now();
      },
      (err) => {
        if (e.gen !== gen) return;
        e.error = err;
        e.updatedAt = Date.now();
      },
    )
    .finally(() => {
      if (e.gen !== gen) return;
      e.promise = undefined;
      e.loading = false;
      emit(e);
    });
  return e.promise;
}

export function getQueryData<T>(key: string): T | undefined {
  return cache.get(key)?.data as T | undefined;
}

export function setQueryData<T>(key: string, updater: (prev: T | undefined) => T | undefined) {
  const e = entry(key);
  e.data = updater(e.data as T | undefined);
  emit(e);
}

export function invalidate(prefix: string) {
  for (const [key, e] of cache) {
    if (!key.startsWith(prefix)) continue;
    e.updatedAt = 0;
    if (e.listeners.size && e.fetcher) fetchQuery(key, e.fetcher);
  }
}

export function clearQueries(prefix = '') {
  for (const [key, e] of [...cache]) {
    if (!key.startsWith(prefix)) continue;
    if (!e.listeners.size) {
      cache.delete(key);
      continue;
    }
    e.gen++;
    e.promise = undefined;
    e.data = undefined;
    e.error = undefined;
    e.updatedAt = 0;
    e.loading = false;
    emit(e);
  }
}

type QueryOptions = { intervalMs?: number; staleMs?: number; enabled?: boolean };

export function useQuery<T>(key: string | null, fetcher: () => Promise<T>, { intervalMs, staleMs = 15000, enabled = true }: QueryOptions = {}) {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const focused = useIsFocused();
  const active = !!key && enabled;

  const subscribe = useCallback(
    (cb: () => void) => {
      if (!key) return () => undefined;
      const e = entry(key);
      e.listeners.add(cb);
      return () => {
        e.listeners.delete(cb);
      };
    },
    [key],
  );
  const version = useSyncExternalStore(subscribe, () => (key ? entry(key).version : -1));
  const gen = key ? entry(key).gen : 0;

  const refetch = useCallback(() => (key ? fetchQuery(key, () => fetcherRef.current()) : Promise.resolve()), [key]);

  useEffect(() => {
    if (!active || !key) return;
    const e = entry(key);
    if (Date.now() - e.updatedAt > staleMs || e.error) refetch();
  }, [active, key, staleMs, refetch, gen]);

  useEffect(() => {
    if (!active || !intervalMs || !focused) return;
    let appActive = AppState.currentState === 'active';
    const id = setInterval(() => {
      if (appActive) refetch();
    }, intervalMs);
    const sub = AppState.addEventListener('change', (s) => {
      appActive = s === 'active';
      if (appActive) refetch();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [active, intervalMs, focused, refetch]);

  void version;
  const e = key ? entry(key) : null;
  return {
    data: e?.data as T | undefined,
    error: e?.error,
    loading: !!e?.loading && e.data === undefined,
    refreshing: !!e?.loading && e.data !== undefined,
    refetch,
  };
}
