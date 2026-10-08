import { useMemo } from 'react';

import { useApi } from './connection';
import { useQuery } from './query';
import type { Camera } from './types';

export function sortCameras(list: Camera[]) {
  return [...list].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function useCameras(opts: { intervalMs?: number } = {}) {
  const { api, scope } = useApi();
  const q = useQuery(`${scope}cameras`, () => api.cameras(), { intervalMs: opts.intervalMs ?? 30000, staleMs: 5000 });
  const cameras = useMemo(() => (q.data ? sortCameras(q.data) : undefined), [q.data]);
  return { ...q, cameras };
}

export function useCamera(id: string | undefined) {
  const q = useCameras();
  return { ...q, camera: q.cameras?.find((c) => c.id === id) };
}

export function groupsOf(cameras: Camera[] | undefined): string[] {
  const set = new Set<string>();
  for (const c of cameras ?? []) if (c.group?.trim()) set.add(c.group.trim());
  return [...set].sort((a, b) => a.localeCompare(b));
}
