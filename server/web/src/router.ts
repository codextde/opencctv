import { useSyncExternalStore } from 'react';

/** Hash router: `#/recordings?camera=abc&day=2026-10-08`. Works under any path prefix. */
export interface Route {
  path: string;
  segments: string[];
  query: URLSearchParams;
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#!?/, '') || '/';
  const [p, q = ''] = raw.split('?');
  const path = '/' + (p ?? '').replace(/^\/+|\/+$/g, '');
  return { path, segments: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q) };
}

let current = parse(window.location.hash);
const listeners = new Set<() => void>();

window.addEventListener('hashchange', () => {
  current = parse(window.location.hash);
  listeners.forEach((l) => l());
});

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => current);
}

export function href(path: string, query?: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  if (query) for (const [k, v] of Object.entries(query)) if (v) q.set(k, v);
  const qs = q.toString();
  return '#' + path + (qs ? '?' + qs : '');
}

export function navigate(path: string, query?: Record<string, string | undefined>, replace = false): void {
  const target = href(path, query);
  if (replace) {
    window.history.replaceState(window.history.state, '', target);
    current = parse(target);
    listeners.forEach((l) => l());
  } else {
    window.location.hash = target.slice(1);
  }
}

/** Update a subset of query params on the current route (replace, no history entry). */
export function setQuery(patch: Record<string, string | undefined>): void {
  const q = Object.fromEntries(current.query.entries()) as Record<string, string | undefined>;
  Object.assign(q, patch);
  navigate(current.path, q, true);
}
