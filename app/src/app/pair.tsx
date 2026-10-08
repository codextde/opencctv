import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { Button, success } from '@/components/ui';
import { useT } from '@/i18n';
import { ApiError, publicApi } from '@/lib/api';
import { isDemoUrl } from '@/lib/config';
import { deviceName, gatewaySiteCount, saveConnection } from '@/lib/onboarding';
import { hostOf, isValidBaseUrl, normalizeBaseUrl } from '@/lib/url';
import { useServers } from '@/store/servers';
import { space, type, useColors } from '@/theme';

export default function Pair() {
  const params = useLocalSearchParams<{ server?: string; code?: string }>();
  const { t } = useT();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const base = normalizeBaseUrl(params.server ?? '');
  const code = (params.code ?? '').trim();
  const hasServers = useServers((s) => s.servers.length > 0);

  const run = useCallback(async () => {
    if (!isValidBaseUrl(base) || !code) {
      setError(t('pair.invalid'));
      return;
    }
    setError(null);
    try {
      const info = await publicApi.info(base).catch(() => null);
      const auth = await publicApi.pair(base, code, info && !info.demo && !isDemoUrl(base) ? deviceName() : undefined);
      const server = await saveConnection(base, auth, info, { demo: isDemoUrl(base) || !!info?.demo });
      success();
      const sites = await gatewaySiteCount(server, auth.token);
      if (sites > 0) router.replace({ pathname: '/sites', params: { gateway: server.id } });
      else router.dismissTo('/');
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 404 || e.status === 410)) setError(t('pair.expired'));
      else if (e instanceof ApiError && e.status === 0) setError(t('connect.errNetwork'));
      else setError(e instanceof Error ? e.message : String(e));
    }
  }, [base, code, t]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run();
  }, [run]);

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: Platform.OS === 'android' ? insets.top + space.xxl : space.xxl, paddingBottom: insets.bottom + space.xl }]}>
      <View style={styles.center}>
        {error ? (
          <View style={[styles.icon, { backgroundColor: c.dangerSoft }]}>
            <Icon name="warning" size={30} color={c.danger} />
          </View>
        ) : (
          <ActivityIndicator size="large" color={c.accent} />
        )}
        <Text style={[type.headline, { color: c.text, textAlign: 'center' }]}>{error ? t('pair.failed') : t('pair.pairing')}</Text>
        <Text style={[type.callout, { color: c.textSecondary, textAlign: 'center' }]}>{error ?? hostOf(base)}</Text>
      </View>
      {error ? (
        <View style={{ gap: space.sm }}>
          <Button title={t('common.retry')} onPress={run} />
          <Button title={t('scan.manual')} variant="ghost" onPress={() => router.replace({ pathname: '/connect', params: { server: base } })} />
          <Button title={t('common.close')} variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace(hasServers ? '/' : '/welcome'))} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  icon: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
