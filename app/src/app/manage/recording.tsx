import { useEffect, useState } from 'react';
import { RefreshControl, View } from 'react-native';

import { SliderDots, Stepper } from '@/components/forms';
import { toast } from '@/components/toast';
import { Field, Group, Loading, Notice, Row, Screen, ToggleRow } from '@/components/ui';
import { useT } from '@/i18n';
import { useApi } from '@/lib/connection';
import { useQuery, setQueryData } from '@/lib/query';
import type { ServerSettings } from '@/lib/types';
import { space, useColors } from '@/theme';

export default function RecordingSettings() {
  const { t } = useT();
  const c = useColors();
  const { api, scope } = useApi();
  const key = `${scope}settings`;
  const q = useQuery<ServerSettings>(key, () => api.settings());
  const [name, setName] = useState('');
  const s = q.data;

  useEffect(() => {
    if (s) setName(s.serverName);
  }, [s?.serverName]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = async (p: Partial<ServerSettings>) => {
    if (!s) return;
    const prev = s;
    setQueryData<ServerSettings>(key, (cur) => (cur ? { ...cur, ...p } : cur));
    try {
      const next = await api.updateSettings(p as Record<string, unknown>);
      if (next) setQueryData<ServerSettings>(key, () => next);
    } catch {
      setQueryData<ServerSettings>(key, () => prev);
      toast(t('common.saveFailed'), 'bad');
    }
  };

  return (
    <Screen underHeader refreshControl={<RefreshControl refreshing={q.refreshing} onRefresh={q.refetch} tintColor={c.textSecondary} />}>
      {q.error ? <Notice tone="danger" icon="warning" title={t('connection.failed')} action={t('common.retry')} onAction={q.refetch} /> : null}
      {!s && !q.error ? <Loading /> : null}
      {s ? (
        <>
          <Group title={t('serverSettings.general')}>
            <View style={{ padding: space.lg }}>
              <Field label={t('serverSettings.serverName')} value={name} onChangeText={setName} onEndEditing={() => name.trim() && name !== s.serverName && patch({ serverName: name.trim() })} />
            </View>
          </Group>
          <Group title={t('serverSettings.recording')} footer={t('serverSettings.recordingHint')}>
            <Row
              title={t('serverSettings.segment')}
              right={<Stepper label={t('serverSettings.segment')} value={s.recording.segmentSeconds} min={10} max={600} step={10} suffix="s" onChange={(v) => patch({ recording: { ...s.recording, segmentSeconds: v } })} />}
            />
            <Row
              title={t('serverSettings.pre')}
              right={<Stepper label={t('serverSettings.pre')} value={s.recording.preMotionSec} min={0} max={60} suffix="s" onChange={(v) => patch({ recording: { ...s.recording, preMotionSec: v } })} />}
            />
            <Row
              title={t('serverSettings.post')}
              right={<Stepper label={t('serverSettings.post')} value={s.recording.postMotionSec} min={0} max={300} step={5} suffix="s" onChange={(v) => patch({ recording: { ...s.recording, postMotionSec: v } })} />}
              last
            />
          </Group>
          <Group title={t('serverSettings.motion')}>
            <View style={{ padding: space.lg, gap: space.sm }}>
              <SliderDots label={t('serverSettings.defaultSensitivity')} value={s.motion.defaultSensitivity} onChange={(v) => patch({ motion: { defaultSensitivity: v } })} />
            </View>
            <Row title={t('serverSettings.defaultSensitivity')} value={`${s.motion.defaultSensitivity}/10`} last />
          </Group>
          <Group title={t('serverSettings.notifications')} footer={t('serverSettings.notificationsHint')}>
            <ToggleRow title={t('serverSettings.notificationsEnabled')} value={s.notifications.enabled} onChange={(v) => patch({ notifications: { ...s.notifications, enabled: v } })} />
            <Row
              title={t('serverSettings.cooldown')}
              right={<Stepper label={t('serverSettings.cooldown')} value={s.notifications.cooldownSec} min={0} max={3600} step={30} suffix="s" onChange={(v) => patch({ notifications: { ...s.notifications, cooldownSec: v } })} />}
              last
            />
          </Group>
        </>
      ) : null}
    </Screen>
  );
}
