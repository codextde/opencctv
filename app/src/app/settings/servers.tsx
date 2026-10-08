import { router } from 'expo-router';
import { Alert, Text } from 'react-native';

import { showActions } from '@/components/action-sheet';
import { Icon } from '@/components/icon';
import { Group, Row, Screen } from '@/components/ui';
import { useT } from '@/i18n';
import { createApi } from '@/lib/api';
import { useMotion } from '@/lib/live-updates';
import { clearQueries } from '@/lib/query';
import { hostOf } from '@/lib/url';
import { tokenOwner, useServers, type ServerEntry } from '@/store/servers';
import { space, type, useColors } from '@/theme';

export default function Servers() {
  const { t } = useT();
  const c = useColors();
  const servers = useServers((s) => s.servers);
  const activeId = useServers((s) => s.activeId);
  const signedOut = useServers((s) => s.signedOut);
  const roots = servers.filter((s) => s.kind === 'server');

  const remove = (s: ServerEntry) => {
    Alert.alert(t('servers.removeTitle', { name: s.name }), s.kind === 'server' && servers.some((x) => x.gatewayId === s.id) ? t('servers.removeGatewayBody') : t('servers.removeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('servers.remove'),
        style: 'destructive',
        onPress: async () => {
          const token = useServers.getState().tokens[tokenOwner(s)];
          if (s.kind === 'server' && token) createApi(s.baseUrl, token).logout().catch(() => undefined);
          const ids = [s.id, ...useServers.getState().servers.filter((x) => x.gatewayId === s.id).map((x) => x.id)];
          await useServers.getState().remove(s.id);
          for (const id of ids) clearQueries(`${id}:`);
          if (!useServers.getState().servers.length) router.replace('/welcome');
        },
      },
    ]);
  };

  const open = (s: ServerEntry) => {
    const owner = servers.find((x) => x.id === tokenOwner(s)) ?? s;
    showActions({
      title: s.name,
      message: hostOf(s.baseUrl),
      actions: [
        {
          label: t('servers.use'),
          icon: 'check',
          selected: s.id === activeId,
          onPress: () => {
            useMotion.setState({ last: {} });
            useServers.getState().activate(s.id);
            router.dismissTo('/');
          },
        },
        ...(s.kind === 'server' ? [{ label: t('servers.sites'), icon: 'gateway' as const, onPress: () => router.push({ pathname: '/sites', params: { gateway: s.id } }) }] : []),
        { label: t('servers.signInAgain'), icon: 'key', onPress: () => router.push({ pathname: '/connect', params: { server: owner.baseUrl, user: owner.username } }) },
        { label: t('servers.remove'), icon: 'trash', destructive: true, onPress: () => remove(s) },
      ],
    });
  };

  return (
    <Screen underHeader>
      {roots.map((root) => {
        const sites = servers.filter((x) => x.gatewayId === root.id);
        const items = [root, ...sites];
        return (
          <Group key={root.id} title={sites.length ? t('servers.gatewayGroup', { name: root.name }) : undefined}>
            {items.map((s, i) => (
              <Row
                key={s.id}
                icon={s.kind === 'site' ? 'home' : s.demo ? 'bolt' : 'server'}
                title={s.name}
                subtitle={`${hostOf(s.baseUrl)} · ${s.username} · ${s.role === 'admin' ? t('users.admin') : t('users.viewer')}${signedOut[tokenOwner(s)] ? ` · ${t('connection.signedOut')}` : ''}`}
                right={s.id === activeId ? <Icon name="checkCircle" size={18} color={c.accentStrong} /> : <Icon name="chevronRight" size={13} color={c.textTertiary} />}
                onPress={() => open(s)}
                last={i === items.length - 1}
              />
            ))}
          </Group>
        );
      })}
      <Group>
        <Row icon="plus" title={t('servers.add')} onPress={() => router.push('/connect')} />
        <Row icon="qr" title={t('welcome.scan')} onPress={() => router.push('/scan')} last />
      </Group>
      <Text style={[type.caption, { color: c.textTertiary, marginHorizontal: space.xs }]}>{t('servers.footer')}</Text>
    </Screen>
  );
}
