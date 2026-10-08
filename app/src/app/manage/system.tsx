import { router } from 'expo-router';
import { RefreshControl, Text, View } from 'react-native';

import { Bar } from '@/components/forms';
import { Icon } from '@/components/icon';
import { Card, Group, Loading, Notice, Row, Screen } from '@/components/ui';
import { useT } from '@/i18n';
import { useApi } from '@/lib/connection';
import { formatBytes, uptimeLabel } from '@/lib/format';
import { useQuery } from '@/lib/query';
import type { SystemInfo } from '@/lib/types';
import { hostOf } from '@/lib/url';
import { space, type, useColors } from '@/theme';

export default function System() {
  const { t, lang } = useT();
  const c = useColors();
  const { api, scope, server } = useApi();
  const q = useQuery<SystemInfo>(`${scope}system`, () => api.system(), { intervalMs: 5000, staleMs: 2000 });
  const d = q.data;
  const disk = d?.disk;
  const diskFraction = disk?.totalBytes ? (disk.usedBytes ?? 0) / disk.totalBytes : 0;

  return (
    <Screen underHeader refreshControl={<RefreshControl refreshing={q.refreshing} onRefresh={q.refetch} tintColor={c.textSecondary} />}>
      {q.error ? <Notice tone="danger" icon="warning" title={t('connection.failed')} action={t('common.retry')} onAction={q.refetch} /> : null}
      {!d && !q.error ? <Loading /> : null}
      {d ? (
        <>
          <Card style={{ gap: space.lg, marginBottom: space.xl }}>
            <View style={{ gap: space.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[type.callout, { color: c.text }]}>{t('system.cpu')}</Text>
                <Text style={[type.callout, { color: c.textSecondary }]}>{Math.round(d.cpuPercent)}%</Text>
              </View>
              <Bar fraction={d.cpuPercent / 100} color={d.cpuPercent > 85 ? c.warn : c.accent} track={c.surfaceSunken} />
            </View>
            <View style={{ gap: space.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[type.callout, { color: c.text }]}>{t('system.disk')}</Text>
                <Text style={[type.callout, { color: c.textSecondary }]}>
                  {disk?.totalBytes ? t('manage.diskOf', { used: formatBytes(disk.usedBytes, lang), total: formatBytes(disk.totalBytes, lang) }) : '–'}
                </Text>
              </View>
              <Bar fraction={diskFraction} color={diskFraction > 0.9 ? c.danger : c.accent} track={c.surfaceSunken} />
            </View>
          </Card>
          <Group title={t('system.server')}>
            <Row title={t('system.address')} value={hostOf(server.baseUrl)} />
            <Row title={t('system.version')} value={d.version} />
            <Row title={t('system.uptime')} value={uptimeLabel(d.uptimeSec, lang)} />
            <Row title={t('system.platform')} value={d.platform} />
            <Row title={t('system.memory')} value={formatBytes(d.memBytes, lang)} />
            <Row title={t('system.cameras')} value={String(d.cameras)} />
            <Row title={t('system.recordings')} value={`${d.recordingsCount} · ${formatBytes(d.recordingsBytes, lang)}`} last />
          </Group>
          <Group title={t('system.components')}>
            {Object.entries(d.components ?? {}).map(([name, comp], i, arr) => (
              <Row
                key={name}
                title={name}
                value={comp.version || '–'}
                right={<Icon name={comp.ok ? 'checkCircle' : 'warning'} size={16} color={comp.ok ? c.accentStrong : c.danger} />}
                last={i === arr.length - 1}
              />
            ))}
          </Group>
          <Group>
            <Row icon="logs" title={t('system.logs')} onPress={() => router.push('/manage/logs')} last />
          </Group>
        </>
      ) : null}
    </Screen>
  );
}
