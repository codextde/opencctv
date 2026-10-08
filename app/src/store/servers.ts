import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { Role } from '@/lib/types';

import { kvStorage } from './kv';

export type ServerEntry = {
  id: string;
  name: string;
  baseUrl: string;
  username: string;
  role: Role;
  kind: 'server' | 'site';
  gatewayId?: string;
  siteId?: string;
  demo?: boolean;
  addedAt: number;
};

type State = {
  servers: ServerEntry[];
  activeId: string | null;
  tokens: Record<string, string>;
  signedOut: Record<string, boolean>;
  tokensLoaded: boolean;
  add: (entry: Omit<ServerEntry, 'id' | 'addedAt'>, token: string | null) => Promise<ServerEntry>;
  update: (id: string, patch: Partial<ServerEntry>) => void;
  remove: (id: string) => Promise<void>;
  activate: (id: string) => void;
  setToken: (id: string, token: string) => Promise<void>;
  markSignedOut: (id: string) => void;
  loadTokens: () => Promise<void>;
};

const tokenKey = (id: string) => `token.${id}`;

export const tokenOwner = (s: ServerEntry) => s.gatewayId ?? s.id;

const newId = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

export const useServers = create<State>()(
  persist(
    (set, get) => ({
      servers: [],
      activeId: null,
      tokens: {},
      signedOut: {},
      tokensLoaded: false,
      add: async (entry, token) => {
        const existing = get().servers.find((s) => s.baseUrl === entry.baseUrl && s.username === entry.username);
        const server: ServerEntry = existing ? { ...existing, ...entry } : { ...entry, id: newId(), addedAt: Date.now() };
        if (token) await SecureStore.setItemAsync(tokenKey(server.id), token);
        set((s) => ({
          servers: existing ? s.servers.map((x) => (x.id === server.id ? server : x)) : [...s.servers, server],
          tokens: token ? { ...s.tokens, [server.id]: token } : s.tokens,
          signedOut: { ...s.signedOut, [server.id]: false },
          activeId: server.id,
        }));
        return server;
      },
      update: (id, patch) => set((s) => ({ servers: s.servers.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      remove: async (id) => {
        const dependents = get().servers.filter((s) => s.gatewayId === id).map((s) => s.id);
        const ids = [id, ...dependents];
        await Promise.all(ids.map((x) => SecureStore.deleteItemAsync(tokenKey(x)).catch(() => undefined)));
        set((s) => {
          const servers = s.servers.filter((x) => !ids.includes(x.id));
          const tokens = { ...s.tokens };
          for (const x of ids) delete tokens[x];
          return { servers, tokens, activeId: ids.includes(s.activeId ?? '') ? (servers[0]?.id ?? null) : s.activeId };
        });
      },
      activate: (id) => set({ activeId: id }),
      setToken: async (id, token) => {
        await SecureStore.setItemAsync(tokenKey(id), token);
        set((s) => ({ tokens: { ...s.tokens, [id]: token }, signedOut: { ...s.signedOut, [id]: false } }));
      },
      markSignedOut: (id) => set((s) => ({ signedOut: { ...s.signedOut, [id]: true } })),
      loadTokens: async () => {
        const tokens: Record<string, string> = {};
        await Promise.all(
          get().servers.map(async (s) => {
            const v = await SecureStore.getItemAsync(tokenKey(s.id)).catch(() => null);
            if (v) tokens[s.id] = v;
          }),
        );
        set({ tokens, tokensLoaded: true });
      },
    }),
    {
      name: 'servers',
      version: 1,
      storage: kvStorage,
      partialize: (s) => ({ servers: s.servers, activeId: s.activeId }) as unknown as State,
    },
  ),
);

export function activeServer(): ServerEntry | null {
  const { servers, activeId } = useServers.getState();
  return servers.find((s) => s.id === activeId) ?? servers[0] ?? null;
}

export function tokenFor(server: ServerEntry | null): string | null {
  if (!server) return null;
  return useServers.getState().tokens[tokenOwner(server)] ?? null;
}
