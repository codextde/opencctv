import * as WebBrowser from 'expo-web-browser';
import { Text } from 'react-native';

import { Group, Row, Screen } from '@/components/ui';
import { useT } from '@/i18n';
import licenses from '@/lib/licenses.json';
import { space, type, useColors } from '@/theme';

export default function Licenses() {
  const { t } = useT();
  const c = useColors();
  return (
    <Screen underHeader>
      <Text style={[type.body, { color: c.textSecondary, marginBottom: space.lg }]}>{t('licenses.intro')}</Text>
      <Group>
        {licenses.map((l, i) => (
          <Row
            key={l.name}
            title={l.name}
            subtitle={`${l.license}${l.version ? ` · ${l.version}` : ''}`}
            onPress={l.url ? () => WebBrowser.openBrowserAsync(l.url) : undefined}
            last={i === licenses.length - 1}
          />
        ))}
      </Group>
    </Screen>
  );
}
