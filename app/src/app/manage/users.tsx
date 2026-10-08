import { router } from 'expo-router';
import { RefreshControl } from 'react-native';

import { Button, Group, Loading, Notice, Row, Screen } from '@/components/ui';
import { useT } from '@/i18n';
import { useApi } from '@/lib/connection';
import { dayLabel } from '@/lib/format';
import { useQuery } from '@/lib/query';
import { dayKey } from '@/lib/timeline';
import type { User } from '@/lib/types';
import { space, useColors } from '@/theme';

export default function Users() {
  const { t, lang } = useT();
  const c = useColors();
  const { api, scope, server } = useApi();
  const q = useQuery<User[]>(`${scope}users`, () => api.users(), { staleMs: 3000 });

  return (
    <Screen underHeader refreshControl={<RefreshControl refreshing={q.refreshing} onRefresh={q.refetch} tintColor={c.textSecondary} />}>
      {q.error ? <Notice tone="danger" icon="warning" title={t('connection.failed')} action={t('common.retry')} onAction={q.refetch} /> : null}
      {q.loading ? <Loading /> : null}
      {q.data ? (
        <Group footer={t('users.footer')}>
          {q.data.map((u, i) => (
            <Row
              key={u.id}
              icon={u.role === 'admin' ? 'key' : 'person'}
              title={u.username + (u.username === server.username ? ` (${t('users.you')})` : '')}
              subtitle={`${u.role === 'admin' ? t('users.admin') : t('users.viewer')} · ${t('users.since', { date: dayLabel(dayKey(Date.parse(u.createdAt)), lang, { relative: false, weekday: false }) })}`}
              onPress={() => router.push({ pathname: '/manage/user', params: { id: u.id } })}
              last={i === q.data!.length - 1}
            />
          ))}
        </Group>
      ) : null}
      <Button title={t('users.add')} icon="plus" variant="secondary" onPress={() => router.push('/manage/user')} style={{ marginBottom: space.md }} />
      <Button title={t('pairing.title')} icon="qr" variant="ghost" onPress={() => router.push('/manage/pairing')} />
    </Screen>
  );
}
