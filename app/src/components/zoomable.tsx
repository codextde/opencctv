import { forwardRef, useImperativeHandle, type ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

type Props = {
  children: ReactNode;
  width: number;
  height: number;
  maxScale?: number;
  style?: StyleProp<ViewStyle>;
  onZoomChange?: (zoomed: boolean) => void;
  onTap?: () => void;
};

export type ZoomableHandle = { reset: () => void };

export const Zoomable = forwardRef<ZoomableHandle, Props>(function Zoomable({ children, width, height, maxScale = 6, style, onZoomChange, onTap }, ref) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const zoomed = useSharedValue(false);

  const notify = (z: boolean) => onZoomChange?.(z);

  const clampTranslate = (s: number, x: number, y: number) => {
    'worklet';
    const maxX = (width * (s - 1)) / 2;
    const maxY = (height * (s - 1)) / 2;
    return { x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) };
  };

  const setZoomed = (z: boolean) => {
    'worklet';
    if (zoomed.value !== z) {
      zoomed.value = z;
      runOnJS(notify)(z);
    }
  };

  const reset = () => {
    'worklet';
    scale.value = withTiming(1);
    savedScale.value = 1;
    tx.value = withTiming(0);
    ty.value = withTiming(0);
    savedTx.value = 0;
    savedTy.value = 0;
    setZoomed(false);
  };

  useImperativeHandle(ref, () => ({
    reset: () => {
      scale.value = withTiming(1);
      savedScale.value = 1;
      tx.value = withTiming(0);
      ty.value = withTiming(0);
      savedTx.value = 0;
      savedTy.value = 0;
      zoomed.value = false;
      onZoomChange?.(false);
    },
  }));

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      const s = Math.min(maxScale, Math.max(0.9, savedScale.value * e.scale));
      scale.value = s;
      const c = clampTranslate(s, savedTx.value, savedTy.value);
      tx.value = c.x;
      ty.value = c.y;
      setZoomed(s > 1.02);
    })
    .onEnd(() => {
      if (scale.value < 1.05) reset();
      else {
        savedScale.value = scale.value;
        savedTx.value = tx.value;
        savedTy.value = ty.value;
      }
    });

  const pan = Gesture.Pan()
    .minPointers(1)
    .manualActivation(true)
    .onTouchesMove((_e, state) => {
      if (zoomed.value) state.activate();
      else state.fail();
    })
    .onUpdate((e) => {
      const c = clampTranslate(scale.value, savedTx.value + e.translationX, savedTy.value + e.translationY);
      tx.value = c.x;
      ty.value = c.y;
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (scale.value > 1.05) {
        reset();
        return;
      }
      const s = 2.5;
      const c = clampTranslate(s, (width / 2 - e.x) * (s - 1), (height / 2 - e.y) * (s - 1));
      scale.value = withTiming(s);
      tx.value = withTiming(c.x);
      ty.value = withTiming(c.y);
      savedScale.value = s;
      savedTx.value = c.x;
      savedTy.value = c.y;
      setZoomed(true);
    });

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd(() => {
      if (onTap) runOnJS(onTap)();
    });

  const gesture = Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, singleTap));

  const animated = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.root, { width, height }, style]} collapsable={false}>
        <Animated.View style={[{ width, height }, animated]}>{children}</Animated.View>
      </Animated.View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({ root: { overflow: 'hidden', backgroundColor: '#000' } });
