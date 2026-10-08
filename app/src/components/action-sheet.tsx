import { useEffect } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { useT } from '@/i18n';
import { radius, space, type, useColors } from '@/theme';

import { Icon } from './icon';
import type { IconName } from './icon-names';
import { tap } from './ui';

export type SheetAction = { label: string; icon?: IconName; destructive?: boolean; selected?: boolean; disabled?: boolean; onPress: () => void };

type SheetState = { open: boolean; title?: string; message?: string; actions: SheetAction[]; cancel?: string };

const useSheet = create<SheetState>()(() => ({ open: false, actions: [] }));

export function showActions(opts: { title?: string; message?: string; actions: SheetAction[]; cancel?: string }) {
  useSheet.setState({ open: true, ...opts });
}

export function ActionSheetHost() {
  const cancelLabel = useT().t('common.cancel');
  const { open, title, message, actions, cancel } = useSheet();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const y = useSharedValue(400);
  const fade = useSharedValue(0);

  useEffect(() => {
    if (open) {
      y.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) });
      fade.value = withTiming(1, { duration: 200 });
    }
  }, [open, y, fade]);

  const close = (after?: () => void) => {
    fade.value = withTiming(0, { duration: 160 });
    y.value = withTiming(400, { duration: 180, easing: Easing.in(Easing.cubic) });
    setTimeout(() => {
      useSheet.setState({ open: false });
      after?.();
    }, 190);
  };

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={() => close()} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => close()} accessibilityLabel={cancel ?? cancelLabel} />
      </Animated.View>
      <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + space.sm }, sheetStyle]} pointerEvents="box-none">
        <View style={[styles.card, { backgroundColor: c.surfaceRaised }]}>
          {title || message ? (
            <View style={[styles.header, { borderBottomColor: c.borderStrong }]}>
              {title ? <Text style={[type.bodyStrong, { color: c.text, textAlign: 'center' }]}>{title}</Text> : null}
              {message ? <Text style={[type.caption, { color: c.textSecondary, textAlign: 'center' }]}>{message}</Text> : null}
            </View>
          ) : null}
          <ScrollView bounces={false} style={{ maxHeight: 440 }}>
            {actions.map((a, i) => (
              <Pressable
                key={`${a.label}-${i}`}
                disabled={a.disabled}
                onPress={() => {
                  tap();
                  close(a.onPress);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: a.selected, disabled: a.disabled }}
                style={({ pressed }) => [
                  styles.action,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
                  pressed && { backgroundColor: c.surfacePressed },
                  a.disabled && { opacity: 0.4 },
                ]}>
                {a.icon ? <Icon name={a.icon} size={19} color={a.destructive ? c.danger : c.text} /> : null}
                <Text style={[type.body, { flex: 1, color: a.destructive ? c.danger : c.text }]}>{a.label}</Text>
                {a.selected ? <Icon name="check" size={16} color={c.accentStrong} /> : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
        <Pressable onPress={() => close()} style={({ pressed }) => [styles.cancel, { backgroundColor: pressed ? c.surfacePressed : c.surfaceRaised }]} accessibilityRole="button">
          <Text style={[type.bodyStrong, { color: c.text }]}>{cancel ?? cancelLabel}</Text>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.sm, gap: space.sm, alignSelf: 'center', maxWidth: 560, width: '100%' },
  card: { borderRadius: radius.lg, overflow: 'hidden' },
  header: { paddingVertical: space.md, paddingHorizontal: space.lg, gap: 2, borderBottomWidth: StyleSheet.hairlineWidth },
  action: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 54 },
  cancel: { borderRadius: radius.lg, minHeight: 54, alignItems: 'center', justifyContent: 'center' },
});
