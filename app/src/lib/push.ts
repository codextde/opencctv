import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { tokenOwner, useServers } from '@/store/servers';
import { useSettings } from '@/store/settings';

import { createApi, type ServerApi } from './api';
import { isDemoUrl } from './config';
import { normalizeBaseUrl } from './url';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export type PushResult = 'ok' | 'denied' | 'unsupported' | 'error';

let cachedToken: string | null = null;

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

export async function pushPermission(): Promise<'granted' | 'denied' | 'undetermined'> {
  const p = await Notifications.getPermissionsAsync();
  return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
}

export async function expoPushToken(ask: boolean): Promise<string | null> {
  if (cachedToken) return cachedToken;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('motion', {
      name: 'Motion',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 120, 200],
      lightColor: '#14B8A6',
    });
  }
  let perm = await Notifications.getPermissionsAsync();
  if (!perm.granted && ask && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return null;
  if (!Device.isDevice && Platform.OS === 'android') return null;
  const id = projectId();
  if (!id) throw new Error('missing-project-id');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('push-token-timeout')), 20000);
  });
  const res = await Promise.race([Notifications.getExpoPushTokenAsync({ projectId: id }), timeout]).finally(() => clearTimeout(timer));
  cachedToken = res.data;
  return cachedToken;
}

export async function enablePush(all: ServerApi[], ask = true): Promise<PushResult> {
  const apis = pushEligible(all);
  if (!apis.length) return 'unsupported';
  try {
    const token = await expoPushToken(ask);
    if (!token) return (await pushPermission()) === 'denied' ? 'denied' : 'unsupported';
    const results = await Promise.allSettled(apis.map((api) => api.registerPush(token, Platform.OS)));
    return results.some((r) => r.status === 'fulfilled') ? 'ok' : 'error';
  } catch (e) {
    return e instanceof Error && e.message === 'missing-project-id' ? 'unsupported' : 'error';
  }
}

export async function disablePush(all: ServerApi[]) {
  const apis = pushEligible(all);
  try {
    const token = cachedToken ?? (await expoPushToken(false));
    if (!token) return;
    await Promise.allSettled(apis.map((api) => api.unregisterPush(token)));
  } catch {}
}

type PushData = { cameraId?: string; eventId?: string; start?: string; server?: string; url?: string };

function open(response: Notifications.NotificationResponse | null) {
  const data = response?.notification.request.content.data as PushData | undefined;
  if (!data) return;
  if (data.server) {
    const base = normalizeBaseUrl(data.server);
    const match = useServers.getState().servers.find((s) => s.baseUrl === base);
    if (match) useServers.getState().activate(match.id);
  }
  if (data.cameraId) {
    const q = [data.start ? `at=${encodeURIComponent(data.start)}` : '', data.eventId ? `event=${encodeURIComponent(data.eventId)}` : ''].filter(Boolean).join('&');
    router.push(`/replay/${encodeURIComponent(data.cameraId)}${q ? `?${q}` : ''}` as never);
  } else if (typeof data.url === 'string' && data.url.startsWith('/')) {
    router.push(data.url as never);
  }
}

export function usePushRouting(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    Notifications.getLastNotificationResponseAsync()
      .then((r) => {
        if (r) {
          open(r);
          Notifications.clearLastNotificationResponseAsync?.().catch(() => undefined);
        }
      })
      .catch(() => undefined);
    return () => sub.remove();
  }, [enabled]);
}

export function pushEnabled() {
  return useSettings.getState().notifications;
}

export function allApis(): ServerApi[] {
  const { servers, tokens } = useServers.getState();
  return servers.filter((s) => tokens[tokenOwner(s)] && !isDemoServer(s)).map((s) => createApi(s.baseUrl, tokens[tokenOwner(s)]));
}

export function isDemoServer(s: { baseUrl: string; demo?: boolean; gatewayId?: string }) {
  if (s.demo || isDemoUrl(s.baseUrl)) return true;
  const gateway = s.gatewayId ? useServers.getState().servers.find((x) => x.id === s.gatewayId) : undefined;
  return !!gateway && (!!gateway.demo || isDemoUrl(gateway.baseUrl));
}

export function pushEligible(apis: ServerApi[]) {
  return apis.filter((a) => !isDemoUrl(a.base));
}
