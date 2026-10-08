import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { fonts, onVideo } from '@/theme';

import { Icon } from './icon';
import type { IconName } from './icon-names';
import { PressableScale } from './pressable-scale';
import { tap } from './ui';

type GlassProps = {
  icon: IconName;
  label: string;
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  active?: boolean;
  activeColor?: string;
  size?: number;
  showLabel?: boolean;
  disabled?: boolean;
  badge?: string;
};

export function GlassButton({ icon, label, onPress, onPressIn, onPressOut, active, activeColor = '#2DD4BF', size = 48, showLabel, disabled, badge }: GlassProps) {
  return (
    <View style={[styles.item, disabled && { opacity: 0.4 }]}>
      <PressableScale
        scaleTo={0.9}
        disabled={disabled}
        onPress={
          onPress
            ? () => {
                tap();
                onPress();
              }
            : undefined
        }
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: !!active, disabled: !!disabled }}
        hitSlop={4}
        style={[styles.glass, { width: size, height: size, borderRadius: size / 2 }, active && { backgroundColor: activeColor, borderColor: activeColor }]}>
        {badge ? <Text style={[styles.badge, active && { color: '#03201C' }]}>{badge}</Text> : <Icon name={icon} size={size * 0.4} color={active ? '#03201C' : '#fff'} />}
      </PressableScale>
      {showLabel ? (
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

export function Shade({ position, height, style }: { position: 'top' | 'bottom'; height: number; style?: StyleProp<ViewStyle> }) {
  const id = `shade-${position}`;
  return (
    <Svg pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, height, [position]: 0 }, style]}>
      <Defs>
        <LinearGradient id={id} x1="0" y1={position === 'top' ? '0' : '1'} x2="0" y2={position === 'top' ? '1' : '0'}>
          <Stop offset="0" stopColor="#000" stopOpacity="0.72" />
          <Stop offset="1" stopColor="#000" stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

export function GlassPill({ children, onPress, style, label }: { children: ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle>; label?: string }) {
  if (!onPress) return <View style={[styles.pill, style]}>{children}</View>;
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [styles.pill, pressed && { backgroundColor: onVideo.glassStrong }, style]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: { alignItems: 'center', gap: 6, minWidth: 56 },
  glass: { alignItems: 'center', justifyContent: 'center', backgroundColor: onVideo.glass, borderWidth: StyleSheet.hairlineWidth, borderColor: onVideo.border },
  label: { color: onVideo.textSecondary, fontFamily: fonts.medium, fontSize: 11 },
  badge: { color: '#fff', fontFamily: fonts.bold, fontSize: 13, letterSpacing: 0.3 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: onVideo.glass, borderWidth: StyleSheet.hairlineWidth, borderColor: onVideo.border },
});
