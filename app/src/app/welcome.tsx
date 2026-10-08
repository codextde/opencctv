import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Button, errorText } from '@/components/ui';
import { useT } from '@/i18n';
import { connectDemo } from '@/lib/onboarding';
import { fonts, radius, space, type } from '@/theme';

const mark = require('../../assets/images/mark.png');

const TILES = [
  { key: 'tileFront', image: require('../../assets/images/hero/front-door.jpg') },
  { key: 'tileDrive', image: require('../../assets/images/hero/parking-deck.jpg') },
  { key: 'tileBack', image: require('../../assets/images/hero/backyard.jpg') },
  { key: 'tileGarage', image: require('../../assets/images/hero/garage.jpg') },
  { key: 'tileStreet', image: require('../../assets/images/hero/street.jpg') },
  { key: 'tileShop', image: require('../../assets/images/hero/storefront.jpg') },
] as const;

function Tile({ label, image, rec, delay, width }: { label: string; image: number; rec: boolean; delay: number; width: number }) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(0.25, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [pulse]);
  const dot = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <Animated.View entering={FadeIn.delay(delay).duration(700)} style={[styles.tile, { width, height: Math.round((width * 10) / 16) }]}>
      <Image source={image} style={StyleSheet.absoluteFill} contentFit="cover" />
      <View style={styles.tileFooter}>
        {rec ? <Animated.View style={[styles.recDot, dot]} /> : null}
        <Text style={styles.tileLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Animated.View>
  );
}

export default function Welcome() {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [demoBusy, setDemoBusy] = useState(false);
  const spin = useSharedValue(0);

  useEffect(() => {
    spin.value = withRepeat(withTiming(1, { duration: 24000, easing: Easing.linear }), -1, false);
  }, [spin]);
  const markStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));

  const tryDemo = async () => {
    setDemoBusy(true);
    try {
      await connectDemo();
      router.replace('/');
    } catch (e) {
      Alert.alert(t('welcome.demoFailed'), errorText(e));
    } finally {
      setDemoBusy(false);
    }
  };

  const landscape = width > height;
  const tileWidth = Math.floor((width + 48 - 16 - 16) / 3);
  const heroHeight = landscape ? height * 0.9 : Math.min(height * 0.5, 470);

  return (
    <View style={styles.root} testID="screen-welcome">
      <ScrollView bounces={false} contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + space.lg }} showsVerticalScrollIndicator={false}>
        <View style={[styles.hero, { height: heroHeight }]}>
          <View style={[styles.mosaic, { top: insets.top + space.md }]}>
            {TILES.map((tile, i) => (
              <Tile key={tile.key} label={t(`welcome.${tile.key}`)} image={tile.image} rec={i === 0 || i === 4} delay={80 + i * 90} width={tileWidth} />
            ))}
          </View>
          <Svg key={width} style={StyleSheet.absoluteFill} pointerEvents="none">
            <Defs>
              <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#0B0D10" stopOpacity="0.25" />
                <Stop offset="0.5" stopColor="#0B0D10" stopOpacity="0.6" />
                <Stop offset="1" stopColor="#0B0D10" stopOpacity="1" />
              </LinearGradient>
              <RadialGradient id="glow" cx="50%" cy="62%" r="36%">
                <Stop offset="0" stopColor="#2DD4BF" stopOpacity="0.3" />
                <Stop offset="1" stopColor="#2DD4BF" stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#fade)" />
            <Rect width="100%" height="100%" fill="url(#glow)" />
          </Svg>
          <View style={styles.markWrap}>
            <Animated.View style={markStyle}>
              <Image source={mark} style={styles.mark} contentFit="contain" />
            </Animated.View>
          </View>
        </View>

        <View style={styles.body}>
          <Animated.Text entering={FadeInDown.delay(200).duration(600)} style={[type.label, styles.eyebrow]}>
            {t('welcome.eyebrow')}
          </Animated.Text>
          <Animated.Text entering={FadeInDown.delay(280).duration(600)} style={[type.hero, styles.title]}>
            {t('welcome.title')}
          </Animated.Text>
          <Animated.Text entering={FadeInDown.delay(360).duration(600)} style={[type.body, styles.text]}>
            {t('welcome.body')}
          </Animated.Text>
          <View style={{ flex: 1, minHeight: space.xl }} />
          <Animated.View entering={FadeInDown.delay(440).duration(600)} style={styles.actions}>
            <Button title={t('welcome.connect')} icon="server" large onPress={() => router.push('/connect')} />
            <Button title={t('welcome.scan')} icon="qr" variant="ink" onPress={() => router.push('/scan')} />
            <Button title={t('welcome.demo')} variant="ghost" loading={demoBusy} onPress={tryDemo} />
          </Animated.View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0D10' },
  hero: { overflow: 'hidden' },
  mosaic: { position: 'absolute', left: -24, right: -24, flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 8, transform: [{ rotate: '-6deg' }, { scale: 1.08 }] },
  tile: { borderRadius: radius.sm, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)' },
  tileFooter: { position: 'absolute', left: 8, bottom: 7, right: 8, flexDirection: 'row', alignItems: 'center', gap: 5 },
  tileLabel: { color: 'rgba(255,255,255,0.7)', fontFamily: fonts.semibold, fontSize: 10 },
  recDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FF5A5F' },
  markWrap: { position: 'absolute', left: 0, right: 0, bottom: 28, alignItems: 'center' },
  mark: { width: 112, height: 112 },
  body: { flex: 1, paddingHorizontal: space.xl, gap: space.md },
  eyebrow: { color: '#2DD4BF' },
  title: { color: '#FFFFFF' },
  text: { color: 'rgba(255,255,255,0.66)', maxWidth: 520 },
  actions: { gap: space.sm, marginTop: space.lg },
});
