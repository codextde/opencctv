import { router } from 'expo-router';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';

import { ConnectionNotice } from '@/components/connection-notice';
import { Bar } from '@/components/forms';
import { ScreenTitle } from '@/components/server-switcher';
import { Card, EmptyState, Group, Row, Screen } from '@/components/ui';
import { useT } from '@/i18n';
import { useApi } from '@/lib/connection';
import { useCameras } from '@/lib/data';
import { formatBytes, uptimeLabel } from '@/lib/format';
import { useQuery } from '@/lib/query';
import type { StorageOverview, SystemInfo } from '@/lib/types';
import { space, type, useColors } from '@/theme';

function Stat({ value, label }: { value: string; label: string }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={[type.value, { color: c.text, fontSize: 24, lineHeight: 28 }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={[type.caption, { color: c.textSecondary }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export default function Manage() {
  const { t, lang } = useT();
  const c = useColors();
  const { api, scope, isAdmin } = useApi();
  const { cameras, refetch: refetchCameras } = useCameras();
  const sys = useQuery<SystemInfo>(`${scope}system`, () => api.system(), { intervalMs: 15000, enabled: isAdmin });
  const storage = useQuery<StorageOverview>(`${scope}storage`, () => api.storage(), { enabled: isAdmin, staleMs: 20000 });

  if (!isAdmin) {
    return (
      <Screen>
        <ScreenTitle title={t('tabs.manage')} />
        <EmptyState icon="lock" title={t('manage.adminOnly')} body={t('manage.adminOnlyBody')} />
      </Screen>
    );
  }

  const online = (cameras ?? []).filter((x) => x.status.online && x.enabled).length;
  const recording = (cameras ?? []).filter((x) => x.status.recording).length;
  const local = storage.data?.local;
  const used = local?.usedBytes ?? sys.data?.disk.usedBytes ?? 0;
  const total = local?.totalBytes ?? sys.data?.disk.totalBytes ?? 0;
  const targets = storage.data?.targets ?? [];
  const targetIssues = targets.filter((x) => x.enabled && !x.status.ok).length;

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={sys.refreshing}
          onRefresh={() => {
            sys.refetch();
            storage.refetch();
            refetchCameras();
          }}
          tintColor={c.textSecondary}
        />
      }>
      <ScreenTitle title={t('tabs.manage')} />
      <ConnectionNotice error={sys.error} onRetry={sys.refetch} />

      <Card style={{ marginBottom: space.xl, gap: space.lg }} onPress={() => router.push('/manage/system')}>
        <View style={styles.stats}>
          <Stat value={cameras ? `${online}/${cameras.length}` : '–'} label={t('manage.camerasOnline')} />
          <Stat value={cameras ? String(recording) : '–'} label={t('manage.recordingNow')} />
          <Stat value={sys.data ? `${Math.round(sys.data.cpuPercent)}%` : '–'} label={t('manage.cpu')} />
        </View>
        <View style={{ gap: space.sm }}>
          <View style={styles.diskRow}>
            <Text style={[type.callout, { color: c.text }]}>{t('manage.disk')}</Text>
            <Text style={[type.caption, { color: c.textSecondary }]}>{total ? t('manage.diskOf', { used: formatBytes(used, lang), total: formatBytes(total, lang) }) : '–'}</Text>
          </View>
          <Bar fraction={total ? used / total : 0} color={total && used / total > 0.9 ? c.danger : c.accent} track={c.surfaceSunken} />
          {sys.data ? (
            <Text style={[type.caption, { color: c.textTertiary }]}>
              {t('manage.versionUptime', { v: sys.data.version, up: uptimeLabel(sys.data.uptimeSec, lang) })}
            </Text>
          ) : null}
        </View>
      </Card>

      <Group title={t('manage.cameras')}>
        <Row icon="camera" title={t('manage.cameras')} value={cameras ? String(cameras.length) : undefined} onPress={() => router.push('/manage/cameras')} />
        <Row icon="plus" title={t('manage.addCamera')} onPress={() => router.push('/manage/add-camera')} last />
      </Group>

      <Group title={t('manage.recordingStorage')}>
        <Row
          icon="storage"
          title={t('storage.title')}
          subtitle={targets.length ? t('storage.targetsSummary', { n: targets.length }) : t('storage.localOnly')}
          value={targetIssues ? t('storage.issues', { n: targetIssues }) : undefined}
          onPress={() => router.push('/manage/storage')}
        />
        <Row icon="record" title={t('serverSettings.title')} subtitle={t('serverSettings.subtitle')} onPress={() => router.push('/manage/recording')} last />
      </Group>

      <Group title={t('manage.access')}>
        <Row icon="people" title={t('users.title')} onPress={() => router.push('/manage/users')} />
        <Row icon="qr" title={t('pairing.title')} subtitle={t('pairing.subtitle')} onPress={() => router.push('/manage/pairing')} />
        <Row icon="gateway" title={t('gateway.title')} subtitle={t('gateway.subtitle')} onPress={() => router.push('/manage/gateway')} last />
      </Group>

      <Group title={t('system.title')}>
        <Row icon="cpu" title={t('system.status')} onPress={() => router.push('/manage/system')} />
        <Row icon="logs" title={t('system.logs')} onPress={() => router.push('/manage/logs')} last />
      </Group>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: space.md },
  diskRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
});
