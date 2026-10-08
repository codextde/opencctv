import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { t, useT } from '@/i18n';
import { useMotion } from '@/lib/live-updates';
import { clearQueries } from '@/lib/query';
import { useServers } from '@/store/servers';
import { space, type, useColors } from '@/theme';

import { showActions } from './action-sheet';
import { Icon } from './icon';
import { tap } from './ui';

export function openServerSwitcher() {
  const { servers, activeId, activate } = useServers.getState();
  showActions({
    title: t('servers.switch'),
    actions: [
      ...servers.map((s) => ({
        label: s.kind === 'site' ? `${s.name}  ·  ${servers.find((g) => g.id === s.gatewayId)?.name ?? ''}` : s.name,
        icon: (s.kind === 'site' ? 'home' : s.demo ? 'bolt' : 'server') as 'home' | 'bolt' | 'server',
        selected: s.id === activeId,
        onPress: () => {
          if (s.id === activeId) return;
          useMotion.setState({ last: {} });
          clearQueries(`${s.id}:`);
          activate(s.id);
        },
      })),
      { label: t('servers.add'), icon: 'plus' as const, onPress: () => router.push('/connect') },
      { label: t('servers.manage'), icon: 'sliders' as const, onPress: () => router.push('/settings/servers') },
    ],
  });
}

export function ScreenTitle({ title, right }: { title: string; right?: React.ReactNode }) {
  const c = useColors();
  const server = useServers((s) => s.servers.find((x) => x.id === s.activeId) ?? s.servers[0]);
  const count = useServers((s) => s.servers.length);
  const connected = useMotion((s) => s.connected);
  const { t: tr } = useT();
  return (
    <View style={styles.header}>
      <View style={{ flex: 1, gap: 2 }}>
        <Pressable
          onPress={() => {
            tap();
            openServerSwitcher();
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={tr('servers.switch')}
          style={styles.server}>
          <View style={[styles.dot, { backgroundColor: connected ? c.accent : c.textTertiary }]} />
          <Text style={[type.label, { color: c.textSecondary, flexShrink: 1 }]} numberOfLines={1}>
            {server?.name ?? ''}
          </Text>
          {count > 0 ? <Icon name="chevronDown" size={10} color={c.textTertiary} /> : null}
        </Pressable>
        <Text style={[type.title, { color: c.text }]} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, marginBottom: space.lg, minHeight: 56 },
  server: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  right: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
});
