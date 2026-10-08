import * as Application from 'expo-application';
import * as LocalAuthentication from 'expo-local-authentication';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert, Linking, Text, View } from 'react-native';

import { ScreenTitle } from '@/components/server-switcher';
import { Group, Row, Screen, Segmented, ToggleRow } from '@/components/ui';
import { useT } from '@/i18n';
import { LINKS } from '@/lib/config';
import { useActiveServer } from '@/lib/connection';
import { allApis, disablePush, enablePush, isDemoServer } from '@/lib/push';
import { hostOf } from '@/lib/url';
import { useServers } from '@/store/servers';
import { useSettings, type AppearancePref, type LanguagePref, type LiveMode } from '@/store/settings';
import { space, type, useColors } from '@/theme';

export default function Settings() {
  const { t } = useT();
  const c = useColors();
  const s = useSettings();
  const server = useActiveServer();
  const count = useServers((x) => x.servers.length);
  const ownServers = useServers((x) => x.servers.filter((sv) => !isDemoServer(sv)).length);
  const demoActive = !!server && isDemoServer(server);
  const [pushBusy, setPushBusy] = useState(false);

  const toggleLock = async (on: boolean) => {
    if (!on) {
      s.set({ appLock: false });
      return;
    }
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.NONE) {
      Alert.alert(t('lock.unavailable'), t('lock.unavailableBody'));
      return;
    }
    const res = await LocalAuthentication.authenticateAsync({ promptMessage: t('lock.enablePrompt'), cancelLabel: t('common.cancel') });
    if (res.success) s.set({ appLock: true });
  };

  const togglePush = async (on: boolean) => {
    setPushBusy(true);
    try {
      if (on) {
        const res = await enablePush(allApis());
        if (res === 'ok') s.set({ notifications: true, pushPrompted: true });
        else if (res === 'denied')
          Alert.alert(t('push.deniedTitle'), t('push.deniedBody'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('common.openSettings'), onPress: () => Linking.openSettings() },
          ]);
        else Alert.alert(t('push.failedTitle'), res === 'unsupported' ? t('push.unsupported') : t('push.failedBody'));
      } else {
        await disablePush(allApis());
        s.set({ notifications: false, pushPrompted: true });
      }
    } finally {
      setPushBusy(false);
    }
  };

  const version = `${Application.nativeApplicationVersion ?? '1.0.0'} (${Application.nativeBuildVersion ?? '1'})`;

  return (
    <Screen>
      <ScreenTitle title={t('tabs.settings')} />

      <Group title={t('settings.server')}>
        {server ? (
          <Row
            icon={server.kind === 'site' ? 'home' : server.demo ? 'bolt' : 'server'}
            title={server.name}
            subtitle={`${hostOf(server.baseUrl)} · ${server.username} · ${server.role === 'admin' ? t('users.admin') : t('users.viewer')}`}
            onPress={() => router.push('/settings/servers')}
          />
        ) : null}
        <Row icon="plus" title={t('servers.add')} value={count > 1 ? t('servers.count', { n: count }) : undefined} onPress={() => router.push('/connect')} last />
      </Group>

      <Group title={t('settings.live')} footer={t('settings.liveModeHint')}>
        <View style={{ padding: space.lg, gap: space.sm }}>
          <Text style={[type.caption, { color: c.textSecondary }]}>{t('settings.liveMode')}</Text>
          <Segmented<LiveMode>
            value={s.liveMode}
            onChange={(v) => s.set({ liveMode: v })}
            options={[
              { value: 'auto', label: t('settings.auto') },
              { value: 'lowLatency', label: t('live.lowLatency') },
              { value: 'hls', label: 'HLS' },
            ]}
          />
        </View>
        <ToggleRow icon="grid" title={t('settings.gridVideo')} subtitle={t('settings.gridVideoHint')} value={s.gridVideo} onChange={(v) => s.set({ gridVideo: v })} />
        <ToggleRow icon="live" title={t('settings.preferHd')} value={s.preferHd} onChange={(v) => s.set({ preferHd: v })} />
        <ToggleRow icon="speakerOff" title={t('settings.startMuted')} value={s.startMuted} onChange={(v) => s.set({ startMuted: v })} last />
      </Group>

      <Group title={t('settings.notifications')} footer={ownServers ? (demoActive ? t('settings.notificationsDemo') : t('settings.notificationsHint')) : t('settings.notificationsDemo')}>
        {ownServers ? (
          <ToggleRow icon="bell" title={t('settings.motionAlerts')} value={s.notifications} onChange={pushBusy ? () => undefined : togglePush} last />
        ) : (
          <Row icon="bell" title={t('settings.motionAlerts')} value={t('settings.notificationsOff')} last />
        )}
      </Group>

      <Group title={t('settings.security')}>
        <ToggleRow icon="faceid" title={t('settings.appLock')} subtitle={t('settings.appLockHint')} value={s.appLock} onChange={toggleLock} last={!s.appLock} />
        {s.appLock ? (
          <View style={{ padding: space.lg, gap: space.sm }}>
            <Text style={[type.caption, { color: c.textSecondary }]}>{t('settings.lockAfter')}</Text>
            <Segmented
              value={String(s.lockAfterSec)}
              onChange={(v) => s.set({ lockAfterSec: Number(v) })}
              options={[
                { value: '0', label: t('settings.immediately') },
                { value: '60', label: t('settings.after1') },
                { value: '300', label: t('settings.after5') },
              ]}
            />
          </View>
        ) : null}
      </Group>

      <Group title={t('settings.appearance')}>
        <View style={{ padding: space.lg, gap: space.sm }}>
          <Text style={[type.caption, { color: c.textSecondary }]}>{t('settings.theme')}</Text>
          <Segmented<AppearancePref>
            value={s.appearance}
            onChange={(v) => s.set({ appearance: v })}
            options={[
              { value: 'system', label: t('settings.system') },
              { value: 'light', label: t('settings.light') },
              { value: 'dark', label: t('settings.dark') },
            ]}
          />
          <Text style={[type.caption, { color: c.textSecondary, marginTop: space.sm }]}>{t('settings.language')}</Text>
          <Segmented<LanguagePref>
            value={s.language}
            onChange={(v) => s.set({ language: v })}
            options={[
              { value: 'system', label: t('settings.system') },
              { value: 'de', label: 'Deutsch' },
              { value: 'en', label: 'English' },
            ]}
          />
        </View>
      </Group>

      <Group title={t('settings.about')}>
        <Row icon="info" title={t('about.title')} onPress={() => router.push('/settings/about')} />
        <Row icon="shield" title={t('privacy.title')} onPress={() => router.push('/settings/privacy')} />
        <Row icon="doc" title={t('licenses.title')} onPress={() => router.push('/settings/licenses')} />
        <Row icon="code" title={t('about.github')} onPress={() => WebBrowser.openBrowserAsync(LINKS.github)} />
        <Row icon="globe" title={t('about.website')} onPress={() => WebBrowser.openBrowserAsync(LINKS.website)} last />
      </Group>

      <Text style={[type.caption, { color: c.textTertiary, textAlign: 'center' }]}>OpenCCTV {version}</Text>
    </Screen>
  );
}
