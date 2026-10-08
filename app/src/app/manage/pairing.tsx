import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CodeBox, QrCode } from '@/components/forms';
import { toast } from '@/components/toast';
import { Button, Notice, Segmented } from '@/components/ui';
import { useT } from '@/i18n';
import { useApi } from '@/lib/connection';
import { clock } from '@/lib/format';
import type { Role } from '@/lib/types';
import { radius, space, type, useColors } from '@/theme';

export default function Pairing() {
  const { t } = useT();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { api } = useApi();
  const [role, setRole] = useState<Role>('viewer');
  const [pair, setPair] = useState<{ code: string; url: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async (r: Role) => {
    setBusy(true);
    setError(null);
    try {
      setPair(await api.pairingCode(r));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    create(role);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: insets.bottom + space.xl, gap: space.lg }}>
      <Text style={[type.title, { color: c.text }]}>{t('pairing.title')}</Text>
      <Text style={[type.body, { color: c.textSecondary }]}>{t('pairing.body')}</Text>
      <Segmented<Role>
        value={role}
        onChange={setRole}
        options={[
          { value: 'viewer', label: t('users.viewer') },
          { value: 'admin', label: t('users.admin') },
        ]}
      />
      {error ? <Notice tone="danger" icon="warning" title={error} action={t('common.retry')} onAction={() => create(role)} /> : null}
      <View style={[styles.qrBox, { borderColor: c.border }]}>{pair && !busy ? <QrCode value={pair.url} size={220} /> : <ActivityIndicator color={c.textSecondary} />}</View>
      {pair ? (
        <>
          <CodeBox code={pair.code} />
          <Text style={[type.caption, { color: c.textTertiary, textAlign: 'center' }]}>{t('pairing.expires', { time: clock(Date.parse(pair.expiresAt)) })}</Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button
              title={t('common.copy')}
              icon="copy"
              variant="secondary"
              style={{ flex: 1 }}
              onPress={async () => {
                await Clipboard.setStringAsync(pair.url);
                toast(t('common.copied'));
              }}
            />
            <Button title={t('common.share')} icon="share" style={{ flex: 1 }} onPress={() => Share.share({ message: pair.url })} />
          </View>
          <Button title={t('pairing.newCode')} variant="ghost" icon="refresh" onPress={() => create(role)} />
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  qrBox: { alignSelf: 'center', width: 252, height: 252, borderRadius: radius.lg, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
});
