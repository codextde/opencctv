import { router } from 'expo-router';
import { View } from 'react-native';

import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import { useConnection } from '@/lib/connection';
import { tokenOwner, useServers } from '@/store/servers';
import { space } from '@/theme';

import { Notice } from './ui';

export function ConnectionNotice({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
  const { server, signedOut } = useConnection();
  const { t } = useT();
  if (!server) return null;
  if (signedOut || (error instanceof ApiError && error.status === 401)) {
    const owner = useServers.getState().servers.find((s) => s.id === tokenOwner(server)) ?? server;
    return (
      <View style={{ marginBottom: space.lg }}>
        <Notice
          tone="warn"
          icon="key"
          title={t('connection.signedOut')}
          body={t('connection.signedOutBody', { server: owner.name })}
          action={t('connect.signIn')}
          onAction={() => router.push({ pathname: '/connect', params: { server: owner.baseUrl, user: owner.username } })}
        />
      </View>
    );
  }
  if (!error) return null;
  const offline = error instanceof ApiError && (error.status === 0 || error.status >= 500);
  return (
    <View style={{ marginBottom: space.lg }}>
      <Notice
        tone="danger"
        icon="warning"
        title={offline ? t('connection.unreachable') : t('connection.failed')}
        body={offline ? t('connection.unreachableBody', { server: server.name }) : error instanceof Error ? error.message : String(error)}
        action={onRetry ? t('common.retry') : undefined}
        onAction={onRetry}
      />
    </View>
  );
}
