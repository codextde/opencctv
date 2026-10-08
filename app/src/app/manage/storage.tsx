import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';

import { showActions } from '@/components/action-sheet';
import { Ring, Stepper } from '@/components/forms';
import { toast } from '@/components/toast';
import { Card, Group, Loading, Notice, Row, Screen, StatusDot, ToggleRow } from '@/components/ui';
import { useT } from '@/i18n';
import { useApi } from '@/lib/connection';
import { formatBytes, relativeTime } from '@/lib/format';
import { useQuery } from '@/lib/query';
import { storageIcon } from '@/lib/storage-icons';
import type { ServerSettings, StorageOverview } from '@/lib/types';
import { space, type, useColors } from '@/theme';

export default function Storage() {
  const { t, lang } = useT();
  const c = useColors();
  const { api, scope } = useApi();
  const q = useQuery<StorageOverview>(`${scope}storage`, () => api.storage(), { intervalMs: 15000, staleMs: 3000 });
  const settings = useQuery<ServerSettings>(`${scope}settings`, () => api.settings());
  const [days, setDays] = useState<number | null>(null);
  const [maxGb, setMaxGb] = useState<number | null>(null);

  useEffect(() => {
    if (settings.data) {
      setDays(settings.data.retention.localDays);
      setMaxGb(settings.data.retention.maxLocalGB);
    }
  }, [settings.data]);

  const saveRetention = async (patch: Partial<ServerSettings['retention']>) => {
    if (!settings.data) return;
    try {
      await api.updateSettings({ retention: { ...settings.data.retention, ...patch } });
      settings.refetch();
      q.refetch();
    } catch {
      toast(t('common.saveFailed'), 'bad');
    }
  };

  const local = q.data?.local;
  const fraction = local && local.totalBytes ? local.usedBytes / local.totalBytes : 0;
  const types = (q.data?.types ?? []).filter((x) => x.type !== 'local');

  const add = () =>
    showActions({
      title: t('storage.addTarget'),
      actions: types.map((x) => ({
        label: x.name,
        icon: storageIcon[x.type] ?? 'cloud',
        onPress: () => router.push({ pathname: '/manage/storage-target', params: { type: x.type } }),
      })),
    });

  return (
    <Screen underHeader refreshControl={<RefreshControl refreshing={q.refreshing} onRefresh={q.refetch} tintColor={c.textSecondary} />}>
      {q.error ? <Notice tone="danger" icon="warning" title={t('connection.failed')} body={String((q.error as Error).message ?? q.error)} action={t('common.retry')} onAction={q.refetch} /> : null}
      {!q.data && !q.error ? <Loading /> : null}
      {local ? (
        <Card style={styles.localCard}>
          <View style={styles.ring}>
            <Ring fraction={fraction} color={fraction > 0.9 ? c.danger : c.accent} track={c.surfaceSunken} size={104} stroke={11} />
            <View style={styles.ringLabel}>
              <Text style={[type.headline, { color: c.text }]}>{Math.round(fraction * 100)}%</Text>
            </View>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[type.label, { color: c.textTertiary }]}>{t('storage.local')}</Text>
            <Text style={[type.headline, { color: c.text }]}>{formatBytes(local.usedBytes, lang)}</Text>
            <Text style={[type.caption, { color: c.textSecondary }]}>{t('storage.freeOf', { free: formatBytes(local.freeBytes, lang), total: formatBytes(local.totalBytes, lang) })}</Text>
            <Text style={[type.caption, { color: c.textTertiary }]} numberOfLines={1}>
              {local.path}
            </Text>
          </View>
        </Card>
      ) : null}

      {settings.data && days !== null && maxGb !== null ? (
        <Group title={t('storage.retention')} footer={t('storage.retentionHint')}>
          <Row
            title={t('storage.keepDays')}
            right={
              <Stepper
                label={t('storage.keepDays')}
                value={days}
                min={1}
                max={365}
                step={days >= 30 ? 5 : 1}
                suffix={t(days === 1 ? 'storage.dayShort' : 'storage.daysShort')}
                onChange={(v) => {
                  setDays(v);
                  saveRetention({ localDays: v });
                }}
              />
            }
          />
          <Row
            title={t('storage.maxSize')}
            right={
              <Stepper
                label={t('storage.maxSize')}
                value={maxGb}
                min={0}
                max={100000}
                step={maxGb >= 100 ? 50 : 10}
                suffix="GB"
                onChange={(v) => {
                  setMaxGb(v);
                  saveRetention({ maxLocalGB: v });
                }}
              />
            }
          />
          <ToggleRow
            title={t('storage.deleteAfterUpload')}
            subtitle={t('storage.deleteAfterUploadHint')}
            value={settings.data.retention.deleteLocalAfterUpload}
            onChange={(v) => saveRetention({ deleteLocalAfterUpload: v })}
            last
          />
        </Group>
      ) : null}

      {q.data ? (
        <Group title={t('storage.targets')} footer={t('storage.targetsHint')}>
          {q.data.targets.map((target) => {
            const status = !target.enabled ? t('storage.paused') : target.status.ok ? t('storage.ok') : t('storage.error');
            const detail = [
              status,
              target.status.queued ? t('storage.queued', { n: target.status.queued }) : null,
              target.status.usedBytes !== undefined ? formatBytes(target.status.usedBytes, lang) : null,
              target.status.lastUpload ? t('storage.lastUpload', { time: relativeTime(Date.parse(target.status.lastUpload), lang) }) : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <Row
                key={target.id}
                icon={storageIcon[target.type] ?? 'cloud'}
                title={target.name}
                subtitle={target.status.error && target.enabled ? `${detail}\n${target.status.error}` : detail}
                right={<StatusDot color={!target.enabled ? c.textTertiary : target.status.ok ? c.accent : c.danger} />}
                onPress={() => router.push({ pathname: '/manage/storage-target', params: { id: target.id } })}
              />
            );
          })}
          <Row icon="plus" title={t('storage.addTarget')} onPress={add} last />
        </Group>
      ) : null}
      <View style={{ height: space.lg }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  localCard: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginBottom: space.xl },
  ring: { width: 104, height: 104 },
  ringLabel: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
