import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { publicApi } from '@/lib/api';
import { SCREENSHOT_MODE } from '@/lib/config';
import { saveConnection } from '@/lib/onboarding';
import { normalizeBaseUrl } from '@/lib/url';
import { useServers } from '@/store/servers';
import { useSettings, type AppearancePref, type LanguagePref } from '@/store/settings';

export default function Shots() {
  const p = useLocalSearchParams<{ server?: string; user?: string; pass?: string; lang?: LanguagePref; theme?: AppearancePref; go?: string; reset?: string }>();
  const [msg, setMsg] = useState('…');

  useEffect(() => {
    if (!SCREENSHOT_MODE) return;
    setMsg('…');
    (async () => {
      try {
        const patch: Partial<ReturnType<typeof useSettings.getState>> = { pushPrompted: true };
        if (p.lang) patch.language = p.lang;
        if (p.theme) patch.appearance = p.theme;
        useSettings.getState().set(patch);
        if (p.reset === '1') {
          for (const s of useServers.getState().servers) await useServers.getState().remove(s.id);
          router.replace('/welcome');
          return;
        }
        if (p.server && p.user && p.pass) {
          const base = normalizeBaseUrl(p.server);
          const existing = useServers.getState().servers.find((s) => s.baseUrl === base && s.username === p.user);
          if (existing) useServers.getState().activate(existing.id);
          else {
            const info = await publicApi.info(base).catch(() => null);
            const auth = await publicApi.login(base, p.user, p.pass);
            await saveConnection(base, auth, info);
          }
        }
        setTimeout(() => router.replace((p.go || '/') as never), 300);
      } catch (e) {
        setMsg(String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(p)]);

  return (
    <View style={{ flex: 1, backgroundColor: '#0B0D10', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#666' }}>{msg}</Text>
    </View>
  );
}
