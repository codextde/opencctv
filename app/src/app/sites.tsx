import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { EmptyState, errorText, Group, IconButton, Loading, Notice, Row, StatusDot, success } from '@/components/ui';
import { useT } from '@/i18n';
import { createApi } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { clearQueries } from '@/lib/query';
import type { Site } from '@/lib/types';
import { siteBaseUrl } from '@/lib/url';
import { useServers } from '@/store/servers';
import { space, type, useColors } from '@/theme';

export default function Sites() {
  const { gateway: gatewayId } = useLocalSearchParams<{ gateway: string }>();
  const { t, lang } = useT();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const gateway = useServers((s) => s.servers.find((x) => x.id === gatewayId));
  const token = useServers((s) => (gatewayId ? s.tokens[gatewayId] : undefined));
  const existing = useServers((s) => s.servers.filter((x) => x.gatewayId === gatewayId));
  const [sites, setSites] = useState<Site[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!gateway || !token) return;
    setLoading(true);
    try {
      const res = await createApi(gateway.baseUrl, token).sites();
      setSites(res.items ?? []);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gatewayId, token]);

  const pick = async (site: Site | null) => {
    if (!gateway) return;
    if (!site) {
      useServers.getState().activate(gateway.id);
    } else {
      const baseUrl = siteBaseUrl(gateway.baseUrl, site.id);
      const entry = await useServers.getState().add(
        { name: site.name, baseUrl, username: gateway.username, role: gateway.role, kind: 'site', gatewayId: gateway.id, siteId: site.id, demo: gateway.demo },
        null,
      );
      clearQueries(`${entry.id}:`);
    }
    success();
    router.dismissTo('/');
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView
        contentContainerStyle={{ padding: space.xl, paddingBottom: insets.bottom + space.xl }}
        refreshControl={<RefreshControl refreshing={loading && !!sites} onRefresh={load} tintColor={c.textSecondary} />}>
        <View style={styles.top}>
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: c.accentStrong }]}>{gateway?.name}</Text>
            <Text style={[type.title, { color: c.text }]}>{t('sites.title')}</Text>
          </View>
          <IconButton icon="close" label={t('common.close')} onPress={() => router.dismissTo('/')} />
        </View>
        <Text style={[type.body, { color: c.textSecondary, marginBottom: space.xl }]}>{t('sites.body')}</Text>
        {error ? <Notice tone="danger" icon="warning" title={t('sites.loadFailed')} body={error} action={t('common.retry')} onAction={load} /> : null}
        {!sites && !error ? <Loading /> : null}
        {sites && sites.length === 0 ? <EmptyState icon="gateway" title={t('sites.empty')} body={t('sites.emptyBody')} /> : null}
        {sites && sites.length > 0 ? (
          <Group>
            {sites.map((site, i) => {
              const added = existing.some((e) => e.siteId === site.id);
              return (
                <Row
                  key={site.id}
                  icon="home"
                  title={site.name}
                  subtitle={
                    site.online
                      ? t('sites.online', { n: site.cameras ?? 0 })
                      : site.lastSeen
                        ? t('sites.lastSeen', { time: relativeTime(Date.parse(site.lastSeen), lang) })
                        : t('sites.offline')
                  }
                  right={
                    <View style={styles.right}>
                      {added ? <Icon name="checkCircle" size={16} color={c.accentStrong} /> : null}
                      <StatusDot color={site.online ? c.accent : c.textTertiary} />
                    </View>
                  }
                  onPress={() => pick(site)}
                  last={i === sites.length - 1}
                />
              );
            })}
          </Group>
        ) : null}
        <Group>
          <Row icon="server" title={t('sites.useGateway')} subtitle={t('sites.useGatewayBody')} onPress={() => pick(null)} last />
        </Group>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, marginBottom: space.sm },
  right: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
