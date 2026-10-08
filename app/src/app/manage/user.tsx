import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Field, Notice, Segmented, success } from '@/components/ui';
import { useT } from '@/i18n';
import { useApi } from '@/lib/connection';
import { getQueryData, invalidate } from '@/lib/query';
import type { Role, User } from '@/lib/types';
import { space, type, useColors } from '@/theme';

export default function UserSheet() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { t } = useT();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { api, scope, server } = useApi();
  const existing = id ? getQueryData<User[]>(`${scope}users`)?.find((u) => u.id === id) : undefined;
  const [username, setUsername] = useState(existing?.username ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>(existing?.role ?? 'viewer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSelf = existing?.username === server.username;

  useEffect(() => {
    if (existing) {
      setUsername(existing.username);
      setRole(existing.role);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id]);

  const save = async () => {
    if (!username.trim() || (!existing && password.length < 8)) {
      setError(!username.trim() ? t('connect.errMissing') : t('connect.errShort'));
      return;
    }
    if (existing && password && password.length < 8) {
      setError(t('connect.errShort'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (existing) await api.updateUser(existing.id, { username: username.trim(), role, ...(password ? { password } : null) });
      else await api.createUser({ username: username.trim(), password, role });
      success();
      invalidate(`${scope}users`);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!existing) return;
    Alert.alert(t('users.deleteTitle', { name: existing.username }), t('users.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteUser(existing.id);
            invalidate(`${scope}users`);
            router.back();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        },
      },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: insets.bottom + space.xl, gap: space.lg }} keyboardShouldPersistTaps="handled">
      <Text style={[type.title, { color: c.text }]}>{existing ? existing.username : t('users.add')}</Text>
      <Field label={t('connect.username')} value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} />
      <Field
        label={existing ? t('users.newPassword') : t('connect.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        textContentType="newPassword"
        hint={existing ? t('users.passwordKeep') : t('connect.passwordHint')}
      />
      <View style={{ gap: space.sm }}>
        <Text style={[type.caption, { color: c.textSecondary }]}>{t('users.role')}</Text>
        <Segmented<Role>
          value={role}
          onChange={(v) => !isSelf && setRole(v)}
          options={[
            { value: 'viewer', label: t('users.viewer') },
            { value: 'admin', label: t('users.admin') },
          ]}
        />
        <Text style={[type.caption, { color: c.textTertiary }]}>{role === 'admin' ? t('users.adminHint') : t('users.viewerHint')}</Text>
      </View>
      {error ? <Notice tone="danger" icon="warning" title={error} /> : null}
      <Button title={existing ? t('common.save') : t('users.create')} onPress={save} loading={busy} />
      {existing && !isSelf ? <Button title={t('users.delete')} variant="danger" icon="trash" onPress={remove} /> : null}
    </ScrollView>
  );
}
