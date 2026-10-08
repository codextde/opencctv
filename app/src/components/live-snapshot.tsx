import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { withQuery } from '@/lib/url';

type Props = { uri: string; intervalMs?: number; active?: boolean; style?: StyleProp<ViewStyle>; contentFit?: 'cover' | 'contain'; onLoad?: () => void };

export function LiveSnapshot({ uri, intervalMs = 2000, active = true, style, contentFit = 'cover', onLoad }: Props) {
  const [slots, setSlots] = useState<[string | null, string | null]>(() => [null, withQuery(uri, { t: Date.now() })]);
  const [front, setFront] = useState<0 | 1 | null>(null);
  const [attempt, setAttempt] = useState(0);

  const firstUri = useRef(uri);
  useEffect(() => {
    if (firstUri.current === uri) return;
    firstUri.current = uri;
    setSlots((s) => (front === 0 ? [s[0], withQuery(uri, { t: Date.now() })] : [withQuery(uri, { t: Date.now() }), s[1]]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  useEffect(() => {
    if (!active || !intervalMs || (front === null && attempt === 0)) return;
    let appActive = AppState.currentState === 'active';
    const sub = AppState.addEventListener('change', (s) => (appActive = s === 'active'));
    const id = setTimeout(() => {
      if (!appActive) return;
      const url = withQuery(uri, { t: Date.now() });
      setSlots((s) => (front === 0 ? [s[0], url] : [url, s[1]]));
    }, front === null ? Math.max(intervalMs, 2500) : intervalMs);
    return () => {
      clearTimeout(id);
      sub.remove();
    };
  }, [active, intervalMs, front, uri, attempt]);

  const layer = (i: 0 | 1) => {
    const src = slots[i];
    if (!src) return null;
    const visible = front === i;
    return (
      <Image
        key={i}
        source={{ uri: src }}
        style={[StyleSheet.absoluteFill, { opacity: visible ? 1 : 0, zIndex: visible ? 1 : 0 }]}
        contentFit={contentFit}
        cachePolicy="none"
        transition={0}
        onLoad={() => {
          if (front !== i) {
            setFront(i);
            onLoad?.();
          }
        }}
        onError={() => {
          if (front !== i) setAttempt((a) => a + 1);
        }}
      />
    );
  };

  return (
    <View style={[styles.root, style]}>
      {layer(0)}
      {layer(1)}
    </View>
  );
}

const styles = StyleSheet.create({ root: { overflow: 'hidden', backgroundColor: '#000' } });
