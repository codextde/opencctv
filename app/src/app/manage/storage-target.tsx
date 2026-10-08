import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CodeBox, DynamicForm, initialValues, missingFields, Stepper } from '@/components/forms';
import { Icon } from '@/components/icon';
import { toast } from '@/components/toast';
import { Button, Field, Group, IconButton, Notice, Row, success, ToggleRow } from '@/components/ui';
import { useT } from '@/i18n';
import { useApi } from '@/lib/connection';
import { invalidate, useQuery } from '@/lib/query';
import { storageIcon } from '@/lib/storage-icons';
import type { GdriveStart, StorageOverview, StorageType } from '@/lib/types';
import { space, type, useColors } from '@/theme';

function GdriveFlow({ name, path }: { name: string; path: string }) {
  const { t } = useT();
  const c = useColors();
  const { api, scope } = useApi();
  const [flow, setFlow] = useState<GdriveStart | null>(null);
  const [status, setStatus] = useState<'idle' | 'starting' | 'pending' | 'done' | 'expired' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = async () => {
    setStatus('starting');
    setError(null);
    try {
      const f = await api.gdriveStart({ name: name.trim() || undefined, path: path.trim() || undefined });
      setFlow(f);
      setStatus('pending');
      if (f.authUrl && !f.userCode) WebBrowser.openBrowserAsync(f.authUrl);
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    if (status !== 'pending' || !flow) return;
    timer.current = setInterval(async () => {
      try {
        const s = await api.gdriveStatus(flow.flowId);
        if (s.status === 'done') {
          setStatus('done');
          success();
          invalidate(`${scope}storage`);
        } else if (s.status === 'expired') setStatus('expired');
        else if (s.status === 'error') {
          setStatus('error');
          setError(s.error ?? null);
        }
      } catch {}
    }, 3000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [status, flow, api, scope]);

  if (status === 'done') {
    return (
      <View style={{ alignItems: 'center', gap: space.md, paddingVertical: space.xl }}>
        <Icon name="checkCircle" size={40} color={c.accentStrong} />
        <Text style={[type.headline, { color: c.text }]}>{t('storage.gdriveDone')}</Text>
        <Button title={t('common.done')} onPress={() => router.back()} style={{ alignSelf: 'stretch' }} />
      </View>
    );
  }

  if (status === 'pending' && flow) {
    return (
      <View style={{ gap: space.lg }}>
        {flow.userCode ? (
          <>
            <Text style={[type.body, { color: c.textSecondary }]}>{t('storage.gdriveCodeBody')}</Text>
            <CodeBox code={flow.userCode} />
            <View style={styles.row}>
              <Button
                title={t('common.copy')}
                icon="copy"
                variant="secondary"
                style={{ flex: 1 }}
                onPress={async () => {
                  await Clipboard.setStringAsync(flow.userCode!);
                  toast(t('common.copied'));
                }}
              />
              <Button title={t('storage.gdriveOpen')} icon="external" style={{ flex: 1.4 }} onPress={() => WebBrowser.openBrowserAsync(flow.verificationUrl ?? 'https://www.google.com/device')} />
            </View>
            <Text style={[type.caption, { color: c.textTertiary, textAlign: 'center' }]}>{flow.verificationUrl}</Text>
          </>
        ) : (
          <>
            <Text style={[type.body, { color: c.textSecondary }]}>{t('storage.gdriveBrowserBody')}</Text>
            <Button title={t('storage.gdriveOpen')} icon="external" onPress={() => flow.authUrl && WebBrowser.openBrowserAsync(flow.authUrl)} />
          </>
        )}
        <View style={styles.waiting}>
          <ActivityIndicator color={c.accentStrong} />
          <Text style={[type.callout, { color: c.textSecondary }]}>{t('storage.gdriveWaiting')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ gap: space.md }}>
      <Text style={[type.body, { color: c.textSecondary }]}>{t('storage.gdriveIntro')}</Text>
      {status === 'expired' ? <Notice tone="warn" icon="warning" title={t('storage.gdriveExpired')} /> : null}
      {status === 'error' ? <Notice tone="danger" icon="warning" title={t('storage.gdriveFailed')} body={error ?? undefined} /> : null}
      <Button title={t('storage.gdriveConnect')} icon="cloud" onPress={start} loading={status === 'starting'} />
    </View>
  );
}

export default function StorageTargetScreen() {
  const params = useLocalSearchParams<{ id?: string; type?: StorageType }>();
  const { t } = useT();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { api, scope } = useApi();
  const q = useQuery<StorageOverview>(`${scope}storage`, () => api.storage());
  const existing = q.data?.targets.find((x) => x.id === params.id);
  const typeId = (existing?.type ?? params.type) as StorageType | undefined;
  const typeDef = q.data?.types.find((x) => x.type === typeId);
  const fields = useMemo(() => typeDef?.fields ?? [], [typeDef]);

  const [name, setName] = useState('');
  const [path, setPath] = useState('OpenCCTV');
  const [retention, setRetention] = useState(30);
  const [enabled, setEnabled] = useState(true);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'test' | 'save' | 'delete' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready || !q.data || !typeDef) return;
    if (existing) {
      setName(existing.name);
      setPath(existing.path);
      setRetention(existing.retentionDays);
      setEnabled(existing.enabled);
      setValues(initialValues(fields, Object.fromEntries(Object.entries(existing.config).map(([k, v]) => [k, v === '***' ? '' : v]))));
    } else {
      setName(typeDef.name);
      setValues(initialValues(fields));
    }
    setReady(true);
  }, [q.data, typeDef, existing, fields, ready]);

  const config = () => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) if (v !== '') out[k] = v;
    return out;
  };

  const required = existing ? new Set<string>() : missingFields(fields, values);

  const test = async () => {
    if (required.size) {
      setShowMissing(true);
      return;
    }
    setBusy('test');
    setResult(null);
    try {
      setResult(await api.testTarget({ type: typeId, name, config: config(), path, retentionDays: retention, ...(existing ? { id: existing.id } : null) } as never));
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (required.size) {
      setShowMissing(true);
      return;
    }
    setBusy('save');
    try {
      if (existing) await api.updateTarget(existing.id, { name, path, retentionDays: retention, enabled, config: config() });
      else await api.createTarget({ type: typeId, name, path, retentionDays: retention, config: config(), enabled: true });
      success();
      invalidate(`${scope}storage`);
      router.back();
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const remove = () => {
    if (!existing) return;
    Alert.alert(t('storage.deleteTitle', { name: existing.name }), t('storage.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          setBusy('delete');
          try {
            await api.deleteTarget(existing.id);
            invalidate(`${scope}storage`);
            router.back();
          } catch (e) {
            toast(e instanceof Error ? e.message : t('common.saveFailed'), 'bad');
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  const isGdriveNew = typeId === 'gdrive' && !existing;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.header, { paddingTop: Platform.OS === 'android' ? insets.top + space.md : space.lg }]}>
        <View style={{ width: 40 }} />
        <Text style={[type.headline, { color: c.text, flex: 1, textAlign: 'center' }]} numberOfLines={1}>
          {existing ? existing.name : (typeDef?.name ?? t('storage.addTarget'))}
        </Text>
        <IconButton icon="close" label={t('common.close')} onPress={() => router.back()} />
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }} keyboardShouldPersistTaps="handled">
        {!typeDef ? <ActivityIndicator color={c.textSecondary} /> : null}
        {typeDef ? (
          <>
            <View style={styles.typeHead}>
              <View style={[styles.typeIcon, { backgroundColor: c.accentSoft }]}>
                <Icon name={storageIcon[typeDef.type] ?? 'cloud'} size={20} color={c.accentStrong} />
              </View>
              <Text style={[type.callout, { color: c.textSecondary, flex: 1 }]}>{typeDef.help}</Text>
            </View>
            <Field label={t('storage.targetName')} value={name} onChangeText={setName} />
            <Field label={t('storage.folder')} value={path} onChangeText={setPath} autoCapitalize="none" autoCorrect={false} hint={t('storage.folderHint')} />
            <Group>
              <Row
                title={t('storage.keepDays')}
                subtitle={t('storage.remoteRetentionHint')}
                right={<Stepper label={t('storage.keepDays')} value={retention} min={1} max={3650} step={retention >= 30 ? 5 : 1} suffix={t(retention === 1 ? 'storage.dayShort' : 'storage.daysShort')} onChange={setRetention} />}
                last={!existing}
              />
              {existing ? <ToggleRow title={t('storage.enabled')} value={enabled} onChange={setEnabled} last /> : null}
            </Group>
            {isGdriveNew ? (
              <GdriveFlow name={name} path={path} />
            ) : (
              <>
                {fields.length ? (
                  <DynamicForm fields={fields} values={values} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} optionalLabel={existing ? t('storage.unchanged') : t('common.optional')} missing={showMissing ? required : undefined} />
                ) : null}
                {result ? <Notice tone={result.ok ? 'good' : 'danger'} icon={result.ok ? 'checkCircle' : 'warning'} title={result.ok ? t('storage.testOk') : t('storage.testFailed')} body={result.error} /> : null}
                <View style={{ gap: space.sm }}>
                  <Button title={t('add.test')} icon="bolt" variant="secondary" onPress={test} loading={busy === 'test'} />
                  <Button title={existing ? t('common.save') : t('storage.addTarget')} onPress={save} loading={busy === 'save'} />
                  {existing ? <Button title={t('storage.delete')} icon="trash" variant="danger" onPress={remove} loading={busy === 'delete'} /> : null}
                </View>
              </>
            )}
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.sm },
  typeHead: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  typeIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: space.sm },
  waiting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingVertical: space.md },
});
