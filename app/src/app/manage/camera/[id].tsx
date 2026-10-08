import * as Clipboard from 'expo-clipboard';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { LiveSnapshot } from '@/components/live-snapshot';
import { SliderDots } from '@/components/forms';
import { toast } from '@/components/toast';
import { Button, Chips, Field, Group, Loading, Row, Screen, Segmented, ToggleRow } from '@/components/ui';
import { useT } from '@/i18n';
import { useApi } from '@/lib/connection';
import { groupsOf, useCameras } from '@/lib/data';
import { relativeTime } from '@/lib/format';
import { invalidate, setQueryData } from '@/lib/query';
import type { Camera, RecordingMode } from '@/lib/types';
import { radius, space, type, useColors } from '@/theme';

export default function CameraSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useT();
  const c = useColors();
  const { api, scope } = useApi();
  const { cameras } = useCameras();
  const camera = cameras?.find((x) => x.id === id);
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [url, setUrl] = useState('');
  const [subUrl, setSubUrl] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!camera) return;
    setName(camera.name);
    setGroup(camera.group ?? '');
    setUrl('');
    setSubUrl('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera?.id]);

  if (!camera) return <Screen underHeader>{cameras ? <Text style={[type.body, { color: c.textSecondary }]}>{t('live.notFound')}</Text> : <Loading />}</Screen>;

  const patch = async (p: Partial<Camera> | Record<string, unknown>) => {
    const prev = cameras;
    setQueryData<Camera[]>(`${scope}cameras`, (list) => list?.map((x) => (x.id === camera.id ? ({ ...x, ...p } as Camera) : x)));
    try {
      const updated = await api.updateCamera(camera.id, p as Record<string, unknown>);
      setQueryData<Camera[]>(`${scope}cameras`, (list) => list?.map((x) => (x.id === camera.id ? updated : x)));
    } catch (e) {
      setQueryData<Camera[]>(`${scope}cameras`, () => prev);
      toast(e instanceof Error ? e.message : t('common.saveFailed'), 'bad');
    }
  };

  const saveName = () => {
    const v = name.trim();
    if (v && v !== camera.name) patch({ name: v });
  };
  const saveGroup = (g = group) => {
    const v = g.trim();
    if (v !== (camera.group ?? '')) patch({ group: v || undefined } as Partial<Camera>);
  };

  const saveUrl = async () => {
    if (!url.trim()) return;
    await patch({ url: url.trim(), subUrl: subUrl.trim() || undefined });
    setUrl('');
    setSubUrl('');
    toast(t('cameras.connectionUpdated'));
  };

  const remove = () => {
    Alert.alert(t('cameras.deleteTitle', { name: camera.name }), t('cameras.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await api.deleteCamera(camera.id);
            setQueryData<Camera[]>(`${scope}cameras`, (list) => list?.filter((x) => x.id !== camera.id));
            invalidate(`${scope}cameras`);
            router.back();
          } catch (e) {
            toast(e instanceof Error ? e.message : t('common.saveFailed'), 'bad');
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };

  const groups = groupsOf(cameras).filter((g) => g !== group);
  const s = camera.status;
  const isPush = camera.source.kind === 'rtmp-push' || camera.source.kind === 'rtsp-push';

  return (
    <Screen underHeader>
      <Stack.Screen options={{ title: camera.name }} />
      <View style={[styles.preview, { backgroundColor: c.tile }]}>
        {s.online ? <LiveSnapshot uri={api.snapshotUrl(camera.id, 960)} intervalMs={4000} style={StyleSheet.absoluteFill} /> : null}
      </View>

      <Group title={t('cameras.general')}>
        <View style={styles.pad}>
          <Field label={t('cameras.name')} value={name} onChangeText={setName} onEndEditing={saveName} returnKeyType="done" />
          <Field label={t('cameras.group')} value={group} onChangeText={setGroup} onEndEditing={() => saveGroup()} placeholder={t('cameras.groupPlaceholder')} returnKeyType="done" />
          <Chips
            items={groups}
            onPick={(g) => {
              setGroup(g);
              saveGroup(g);
            }}
          />
        </View>
        <ToggleRow icon="power" title={t('cameras.enabled')} subtitle={t('cameras.enabledHint')} value={camera.enabled} onChange={(v) => patch({ enabled: v })} last />
      </Group>

      <Group title={t('cameras.recording')} footer={t('cameras.recordingHint')}>
        <View style={styles.pad}>
          <Segmented<RecordingMode>
            value={camera.recording.mode}
            onChange={(v) => patch({ recording: { ...camera.recording, mode: v } })}
            options={[
              { value: 'continuous', label: t('cameras.modeContinuous') },
              { value: 'motion', label: t('cameras.modeMotion') },
              { value: 'off', label: t('cameras.modeOff') },
            ]}
          />
        </View>
        {camera.capabilities.substream ? (
          <ToggleRow title={t('cameras.useSubstream')} subtitle={t('cameras.useSubstreamHint')} value={camera.recording.useSubstream} onChange={(v) => patch({ recording: { ...camera.recording, useSubstream: v } })} last />
        ) : null}
      </Group>

      <Group title={t('cameras.motion')}>
        <ToggleRow icon="motion" title={t('cameras.motionDetection')} value={camera.motion.enabled} onChange={(v) => patch({ motion: { ...camera.motion, enabled: v } })} />
        {camera.motion.enabled ? (
          <View style={styles.pad}>
            <View style={styles.between}>
              <Text style={[type.callout, { color: c.text }]}>{t('cameras.sensitivity')}</Text>
              <Text style={[type.callout, { color: c.textSecondary }]}>{camera.motion.sensitivity}/10</Text>
            </View>
            <SliderDots label={t('cameras.sensitivity')} value={camera.motion.sensitivity} onChange={(v) => patch({ motion: { ...camera.motion, sensitivity: v } })} />
          </View>
        ) : null}
        <ToggleRow icon="bell" title={t('cameras.notify')} subtitle={t('cameras.notifyHint')} value={camera.motion.notify} onChange={(v) => patch({ motion: { ...camera.motion, notify: v } })} last />
      </Group>

      <Group title={t('cameras.status')}>
        <Row title={t('cameras.state')} value={s.online ? t('live.online') : t('live.offline')} />
        {s.codec ? <Row title={t('cameras.codec')} value={s.codec.toUpperCase()} /> : null}
        {s.width && s.height ? <Row title={t('cameras.resolution')} value={`${s.width}×${s.height}${s.fps ? ` · ${Math.round(s.fps)} fps` : ''}`} /> : null}
        {s.bitrateKbps ? <Row title={t('cameras.bitrate')} value={`${(s.bitrateKbps / 1000).toFixed(1)} Mbit/s`} /> : null}
        {s.lastSeen ? <Row title={t('cameras.lastSeen')} value={relativeTime(Date.parse(s.lastSeen), lang)} /> : null}
        <Row title={t('cameras.brand')} value={camera.brand} />
        <Row title={t('cameras.source')} subtitle={camera.source.url} last={!s.error} />
        {s.error ? <Row title={t('cameras.error')} subtitle={s.error} last /> : null}
      </Group>

      {isPush && camera.push?.url ? (
        <Group title={t('cameras.pushUrl')} footer={t('cameras.pushHint')}>
          <Row
            icon="copy"
            title={camera.push.url}
            onPress={async () => {
              await Clipboard.setStringAsync(camera.push!.url);
              toast(t('common.copied'));
            }}
            last
          />
        </Group>
      ) : (
        <Group title={t('cameras.connection')} footer={t('cameras.connectionHint')}>
          <View style={styles.pad}>
            <Field label={t('cameras.streamUrl')} value={url} onChangeText={setUrl} placeholder="rtsp://user:pass@192.168.1.20:554/stream1" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
            <Field label={t('cameras.subUrl')} value={subUrl} onChangeText={setSubUrl} placeholder="rtsp://…/stream2" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
            <Button title={t('cameras.updateConnection')} variant="secondary" compact onPress={saveUrl} disabled={!url.trim()} />
          </View>
        </Group>
      )}

      <Button title={t('cameras.delete')} variant="danger" icon="trash" onPress={remove} loading={deleting} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.lg, overflow: 'hidden', marginBottom: space.xl },
  pad: { padding: space.lg, gap: space.md },
  between: { flexDirection: 'row', justifyContent: 'space-between' },
});
