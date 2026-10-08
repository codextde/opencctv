import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { useServers, type ServerEntry } from '@/store/servers';
import { useSettings } from '@/store/settings';

import { createApi, publicApi } from './api';

import { DEMO, isDemoUrl } from './config';
import { enablePush } from './push';
import { clearQueries } from './query';
import type { AuthResponse, ServerInfo } from './types';
import { hostOf, normalizeBaseUrl } from './url';

export function deviceName(): string {
  return Device.deviceName || Device.modelName || (Platform.OS === 'ios' ? 'iPhone' : 'Android');
}

export async function saveConnection(baseUrl: string, auth: AuthResponse, info: ServerInfo | null, opts: { demo?: boolean } = {}): Promise<ServerEntry> {
  const name = info?.name?.trim() || hostOf(baseUrl);
  const server = await useServers.getState().add(
    { name, baseUrl, username: auth.user.username, role: auth.user.role, kind: 'server', demo: !!opts.demo || isDemoUrl(baseUrl) || !!info?.demo },
    auth.token,
  );
  clearQueries(`${server.id}:`);
  if (useSettings.getState().notifications && !server.demo) enablePush([createApi(baseUrl, auth.token)], false).catch(() => undefined);
  return server;
}

export async function connectDemo(): Promise<ServerEntry> {
  const base = normalizeBaseUrl(DEMO.baseUrl);
  const info = await publicApi.info(base).catch(() => null);
  const auth = await publicApi.login(base, DEMO.username, DEMO.password);
  return saveConnection(base, auth, info, { demo: true });
}

export async function gatewaySiteCount(server: ServerEntry, token: string): Promise<number> {
  try {
    const res = await createApi(server.baseUrl, token).sites();
    return res.items?.length ?? 0;
  } catch {
    return 0;
  }
}
