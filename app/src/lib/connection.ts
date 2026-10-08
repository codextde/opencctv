import { useMemo } from 'react';

import { useServers, tokenOwner, type ServerEntry } from '@/store/servers';

import { createApi, type ServerApi } from './api';

export function useActiveServer(): ServerEntry | null {
  return useServers((s) => s.servers.find((x) => x.id === s.activeId) ?? s.servers[0] ?? null);
}

export function useConnection() {
  const server = useActiveServer();
  const token = useServers((s) => (server ? (s.tokens[tokenOwner(server)] ?? null) : null));
  const signedOut = useServers((s) => (server ? !!s.signedOut[tokenOwner(server)] : false));
  const baseUrl = server?.baseUrl;
  const owner = server ? tokenOwner(server) : null;
  const api = useMemo<ServerApi | null>(
    () => (baseUrl ? createApi(baseUrl, token, () => owner && useServers.getState().markSignedOut(owner)) : null),
    [baseUrl, token, owner],
  );
  return { server, token, api, signedOut, isAdmin: server?.role === 'admin', scope: server ? `${server.id}:` : 'none:' };
}

export function useApi() {
  const c = useConnection();
  return { ...c, api: c.api as ServerApi, server: c.server as ServerEntry };
}
