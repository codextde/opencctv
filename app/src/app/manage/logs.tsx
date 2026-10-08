import { useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Loading, Notice, Segmented } from '@/components/ui';
import { useT } from '@/i18n';
import { useApi } from '@/lib/connection';
import { useQuery } from '@/lib/query';
import { radius, space, useColors } from '@/theme';

export default function Logs() {
  const { t } = useT();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { api, scope } = useApi();
  const [live, setLive] = useState<'on' | 'off'>('on');
  const q = useQuery<{ lines: string[] }>(`${scope}logs`, () => api.logs(300), { intervalMs: live === 'on' ? 4000 : undefined, staleMs: 1000 });
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    if (live === 'on') setTimeout(() => scroll.current?.scrollToEnd({ animated: false }), 50);
  }, [q.data, live]);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView
        ref={scroll}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xl, gap: space.md }}
        refreshControl={<RefreshControl refreshing={q.refreshing} onRefresh={q.refetch} tintColor={c.textSecondary} />}>
        <Segmented
          value={live}
          onChange={setLive}
          options={[
            { value: 'on', label: t('system.follow') },
            { value: 'off', label: t('system.paused') },
          ]}
        />
        {q.error ? <Notice tone="danger" icon="warning" title={t('connection.failed')} /> : null}
        {q.loading ? <Loading /> : null}
        <View style={[styles.box, { backgroundColor: c.surfaceSunken, borderColor: c.border }]}>
          {(q.data?.lines ?? []).map((line, i) => (
            <Text
              key={i}
              selectable
              style={[styles.line, { color: /error|fail|fatal/i.test(line) ? c.danger : /warn/i.test(line) ? c.warn : c.textSecondary }]}>
              {line}
            </Text>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, padding: space.md, gap: 2 },
  line: { fontFamily: 'Menlo', fontSize: 10.5, lineHeight: 14 },
});
