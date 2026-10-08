import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Alert, RefreshControl, Text, View } from 'react-native';

import { CodeBox } from '@/components/forms';
import { toast } from '@/components/toast';
import { Button, Card, Field, Group, Notice, Row, Screen, StatusDot, success } from '@/components/ui';
import { useT } from '@/i18n';
import { useApi } from '@/lib/connection';
import { relativeTime } from '@/lib/format';
import { useQuery } from '@/lib/query';
import type { ServerSettings, Site } from '@/lib/types';
import { normalizeBaseUrl } from '@/lib/url';
import { space, type, useColors } from '@/theme';

export default function Gateway() {
  const { t, lang } = useT();
  const c = useColors();
  const { api, scope } = useApi();
  const settings = useQuery<ServerSettings>(`${scope}settings`, () => api.settings(), { intervalMs: 10000 });
  const sites = useQuery<{ items: Site[] }>(`${scope}sites`, () => api.sites(), { intervalMs: 15000 });
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [siteName, setSiteName] = useState('');
  const [created, setCreated] = useState<{ name: string; linkCode: string } | null>(null);

  const gw = settings.data?.gateway;

  const link = async () => {
    if (!url.trim() || !code.trim()) {
      setError(t('connect.errMissing'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.linkGateway(normalizeBaseUrl(url), code.trim());
      success();
      setUrl('');
      setCode('');
      settings.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const unlink = () =>
    Alert.alert(t('gateway.unlinkTitle'), t('gateway.unlinkBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('gateway.unlink'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.unlinkGateway();
            settings.refetch();
          } catch (e) {
            toast(e instanceof Error ? e.message : t('common.saveFailed'), 'bad');
          }
        },
      },
    ]);

  const createSite = async () => {
    if (!siteName.trim()) return;
    try {
      const res = await api.createSite(siteName.trim());
      setCreated({ name: res.name, linkCode: res.linkCode });
      setSiteName('');
      sites.refetch();
      success();
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.saveFailed'), 'bad');
    }
  };

  const removeSite = (s: Site) =>
    Alert.alert(t('gateway.deleteSiteTitle', { name: s.name }), t('gateway.deleteSiteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteSite(s.id);
            sites.refetch();
          } catch (e) {
            toast(e instanceof Error ? e.message : t('common.saveFailed'), 'bad');
          }
        },
      },
    ]);

  return (
    <Screen
      underHeader
      refreshControl={
        <RefreshControl
          refreshing={settings.refreshing}
          onRefresh={() => {
            settings.refetch();
            sites.refetch();
          }}
          tintColor={c.textSecondary}
        />
      }>
      <Text style={[type.body, { color: c.textSecondary, marginBottom: space.xl }]}>{t('gateway.intro')}</Text>

      <Group title={t('gateway.remoteAccess')} footer={gw?.url ? undefined : t('gateway.linkHint')}>
        {gw?.url ? (
          <>
            <Row
              icon="gateway"
              title={gw.siteName || gw.url}
              subtitle={gw.url}
              right={
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <StatusDot color={gw.connected ? c.accent : c.danger} />
                  <Text style={[type.caption, { color: c.textSecondary }]}>{gw.connected ? t('gateway.connected') : t('gateway.disconnected')}</Text>
                </View>
              }
            />
            <Row icon="trash" title={t('gateway.unlink')} destructive onPress={unlink} last />
          </>
        ) : (
          <View style={{ padding: space.lg, gap: space.md }}>
            <Field label={t('gateway.url')} value={url} onChangeText={setUrl} placeholder="https://gateway.example.com" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
            <Field label={t('gateway.linkCode')} value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} />
            {error ? <Notice tone="danger" icon="warning" title={error} /> : null}
            <Button title={t('gateway.link')} onPress={link} loading={busy} />
          </View>
        )}
      </Group>

      <Group title={t('gateway.sites')} footer={t('gateway.sitesHint')}>
        {(sites.data?.items ?? []).map((s) => (
          <Row
            key={s.id}
            icon="home"
            title={s.name}
            subtitle={s.online ? t('sites.online', { n: s.cameras ?? 0 }) : s.lastSeen ? t('sites.lastSeen', { time: relativeTime(Date.parse(s.lastSeen), lang) }) : t('sites.offline')}
            right={<StatusDot color={s.online ? c.accent : c.textTertiary} />}
            onPress={() => removeSite(s)}
          />
        ))}
        <View style={{ padding: space.lg, gap: space.md }}>
          <Field label={t('gateway.newSite')} value={siteName} onChangeText={setSiteName} placeholder={t('gateway.newSitePlaceholder')} returnKeyType="done" onSubmitEditing={createSite} />
          <Button title={t('gateway.createSite')} variant="secondary" compact icon="plus" onPress={createSite} disabled={!siteName.trim()} />
        </View>
      </Group>

      {created ? (
        <Card style={{ gap: space.md, marginBottom: space.xl }}>
          <Text style={[type.bodyStrong, { color: c.text }]}>{t('gateway.codeFor', { name: created.name })}</Text>
          <CodeBox code={created.linkCode} />
          <Text style={[type.caption, { color: c.textSecondary }]}>{t('gateway.codeHint')}</Text>
          <Button
            title={t('common.copy')}
            icon="copy"
            variant="secondary"
            compact
            onPress={async () => {
              await Clipboard.setStringAsync(created.linkCode);
              toast(t('common.copied'));
            }}
          />
        </Card>
      ) : null}
    </Screen>
  );
}
