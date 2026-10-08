import * as WebBrowser from 'expo-web-browser';
import { Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import type { IconName } from '@/components/icon-names';
import { Button, Card, Screen } from '@/components/ui';
import { useT, type Key } from '@/i18n';
import { LINKS } from '@/lib/config';
import { space, type, useColors } from '@/theme';

const POINTS: { icon: IconName; title: Key; body: Key }[] = [
  { icon: 'person', title: 'privacy.noAccountTitle', body: 'privacy.noAccountBody' },
  { icon: 'server', title: 'privacy.directTitle', body: 'privacy.directBody' },
  { icon: 'eyeOff', title: 'privacy.noTrackingTitle', body: 'privacy.noTrackingBody' },
  { icon: 'lock', title: 'privacy.storageTitle', body: 'privacy.storageBody' },
  { icon: 'bell', title: 'privacy.pushTitle', body: 'privacy.pushBody' },
  { icon: 'snapshot', title: 'privacy.permissionsTitle', body: 'privacy.permissionsBody' },
];

export default function Privacy() {
  const { t } = useT();
  const c = useColors();
  return (
    <Screen underHeader>
      <Text style={[type.body, { color: c.textSecondary, marginBottom: space.xl }]}>{t('privacy.intro')}</Text>
      <View style={{ gap: space.md, marginBottom: space.xl }}>
        {POINTS.map((p) => (
          <Card key={p.title} style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={p.icon} size={16} color={c.accentStrong} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[type.bodyStrong, { color: c.text }]}>{t(p.title)}</Text>
              <Text style={[type.callout, { color: c.textSecondary }]}>{t(p.body)}</Text>
            </View>
          </Card>
        ))}
      </View>
      <Button title={t('privacy.full')} variant="secondary" icon="external" onPress={() => WebBrowser.openBrowserAsync(LINKS.privacy)} />
    </Screen>
  );
}
