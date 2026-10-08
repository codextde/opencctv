import * as Haptics from 'expo-haptics';
import { useEffect, type ReactNode } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';

type Props<T> = {
  items: T[];
  keyOf: (item: T) => string;
  rowHeight: number;
  renderItem: (item: T, handle: ReactNode) => ReactNode;
  renderHandle: () => ReactNode;
  onReorder: (keys: string[]) => void;
};

function Row<T>({
  item,
  id,
  positions,
  activeId,
  count,
  rowHeight,
  renderItem,
  renderHandle,
  onDrop,
}: {
  item: T;
  id: string;
  positions: SharedValue<Record<string, number>>;
  activeId: SharedValue<string | null>;
  count: number;
  rowHeight: number;
  renderItem: Props<T>['renderItem'];
  renderHandle: Props<T>['renderHandle'];
  onDrop: () => void;
}) {
  const top = useSharedValue((positions.value[id] ?? 0) * rowHeight);
  const startTop = useSharedValue(0);

  useAnimatedReaction(
    () => positions.value[id],
    (pos, prev) => {
      if (pos !== prev && pos !== undefined && activeId.value !== id) top.value = withTiming(pos * rowHeight, { duration: 180 });
    },
  );

  const buzz = () => Haptics.selectionAsync().catch(() => undefined);
  const lift = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);

  const pan = Gesture.Pan()
    .activateAfterLongPress(120)
    .onStart(() => {
      activeId.value = id;
      startTop.value = top.value;
      runOnJS(lift)();
    })
    .onUpdate((e) => {
      top.value = Math.max(-rowHeight / 2, Math.min((count - 0.5) * rowHeight, startTop.value + e.translationY));
      const next = Math.max(0, Math.min(count - 1, Math.round(top.value / rowHeight)));
      const cur = positions.value[id];
      if (next !== cur) {
        const updated: Record<string, number> = { ...positions.value };
        for (const k in updated) {
          if (updated[k] === next) updated[k] = cur;
        }
        updated[id] = next;
        positions.value = updated;
        runOnJS(buzz)();
      }
    })
    .onFinalize(() => {
      top.value = withSpring(positions.value[id] * rowHeight, { damping: 20, stiffness: 240 });
      if (activeId.value === id) {
        activeId.value = null;
        runOnJS(onDrop)();
      }
    });

  const style = useAnimatedStyle(() => {
    const active = activeId.value === id;
    return {
      position: 'absolute',
      left: 0,
      right: 0,
      height: rowHeight,
      top: top.value,
      zIndex: active ? 10 : 0,
      transform: [{ scale: withSpring(active ? 1.02 : 1) }],
      shadowColor: '#000',
      shadowOpacity: withTiming(active ? 0.25 : 0),
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: active ? 6 : 0,
    };
  });

  const handle = (
    <GestureDetector gesture={pan}>
      <View hitSlop={10}>{renderHandle()}</View>
    </GestureDetector>
  );

  return <Animated.View style={style}>{renderItem(item, handle)}</Animated.View>;
}

export function DraggableList<T>({ items, keyOf, rowHeight, renderItem, renderHandle, onReorder }: Props<T>) {
  const positions = useSharedValue<Record<string, number>>(Object.fromEntries(items.map((it, i) => [keyOf(it), i])));
  const activeId = useSharedValue<string | null>(null);
  const keys = items.map(keyOf).join('|');

  useEffect(() => {
    positions.value = Object.fromEntries(items.map((it, i) => [keyOf(it), i]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);

  const onDrop = () => {
    const order = Object.entries(positions.value)
      .sort((a, b) => a[1] - b[1])
      .map(([k]) => k);
    onReorder(order);
  };

  return (
    <View style={{ height: items.length * rowHeight }}>
      {items.map((item) => (
        <Row
          key={keyOf(item)}
          id={keyOf(item)}
          item={item}
          positions={positions}
          activeId={activeId}
          count={items.length}
          rowHeight={rowHeight}
          renderItem={renderItem}
          renderHandle={renderHandle}
          onDrop={onDrop}
        />
      ))}
    </View>
  );
}
