import * as Application from 'expo-application';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { StyleSheet, Text, View } from 'react-native';

import { Group, Row, Screen } from '@/components/ui';
import { useT } from '@/i18n';
import { LINKS } from '@/lib/config';
import { space, type, useColors } from '@/theme';

const icon = require('../../../assets/images/icon.png');

export default function About() {
  const { t } = useT();
  const c = useColors();
  return (
    <Screen underHeader>
      <View style={styles.hero}>
        <Image source={icon} style={styles.icon} />
        <Text style={[type.title, { color: c.text }]}>OpenCCTV</Text>
        <Text style={[type.callout, { color: c.textSecondary }]}>
          {t('about.version', { v: Application.nativeApplicationVersion ?? '1.0.0', b: Application.nativeBuildVersion ?? '1' })}
        </Text>
        <Text style={[type.body, { color: c.textSecondary, textAlign: 'center', marginTop: space.sm }]}>{t('about.body')}</Text>
      </View>
      <Group>
        <Row icon="code" title={t('about.github')} subtitle="github.com/codextde/opencctv" onPress={() => WebBrowser.openBrowserAsync(LINKS.github)} />
        <Row icon="globe" title={t('about.website')} subtitle="opencctv.codext.de" onPress={() => WebBrowser.openBrowserAsync(LINKS.website)} />
        <Row icon="heart" title={t('about.company')} subtitle="codext.de" onPress={() => WebBrowser.openBrowserAsync(LINKS.company)} last />
      </Group>
      <Text style={[type.caption, { color: c.textTertiary, textAlign: 'center' }]}>{t('about.license')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.xs, paddingVertical: space.xl, paddingHorizontal: space.lg },
  icon: { width: 88, height: 88, borderRadius: 20, marginBottom: space.md },
});
