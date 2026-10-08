import qrcode from 'qrcode-generator';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import type { Field as FieldDef } from '@/lib/types';
import { fonts, radius, space, type, useColors } from '@/theme';

import { Icon } from './icon';
import { PressableScale } from './pressable-scale';
import { Field, IconButton, tap } from './ui';

function optionList(f: FieldDef) {
  return (f.options ?? []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
}

export function OptionChips({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  const c = useColors();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }} keyboardShouldPersistTaps="handled">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <PressableScale
            key={o.value}
            onPress={() => {
              tap();
              onChange(o.value);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.chip, { backgroundColor: active ? c.accent : c.surface, borderColor: active ? c.accent : c.borderStrong }]}>
            <Text style={[type.callout, { color: active ? c.onAccent : c.text }]}>{o.label}</Text>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}

function SecretField({ field, value, onChange, optional }: { field: FieldDef; value: string; onChange: (v: string) => void; optional: string }) {
  const [show, setShow] = useState(false);
  return (
    <Field
      label={field.required ? field.label : `${field.label} (${optional})`}
      value={value}
      onChangeText={onChange}
      placeholder={field.placeholder}
      secureTextEntry={!show}
      autoCapitalize="none"
      autoCorrect={false}
      textContentType="password"
      hint={field.help}
      right={<IconButton icon={show ? 'eyeOff' : 'eye'} size={32} label="show" onPress={() => setShow((v) => !v)} style={{ backgroundColor: 'transparent' }} />}
    />
  );
}

export function DynamicForm({
  fields,
  values,
  onChange,
  optionalLabel,
  missing,
}: {
  fields: FieldDef[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  optionalLabel: string;
  missing?: Set<string>;
}) {
  const c = useColors();
  return (
    <View style={{ gap: space.lg }}>
      {fields.map((f) => {
        const value = values[f.key] ?? '';
        if (f.type === 'select') {
          const opts = optionList(f);
          return (
            <View key={f.key} style={{ gap: 6 }}>
              <Text style={[type.caption, { color: c.textSecondary }]}>{f.label}</Text>
              <OptionChips options={opts} value={value || opts[0]?.value || ''} onChange={(v) => onChange(f.key, v)} />
              {f.help ? <Text style={[type.caption, { color: c.textTertiary }]}>{f.help}</Text> : null}
            </View>
          );
        }
        if (f.type === 'password') return <SecretField key={f.key} field={f} value={value} onChange={(v) => onChange(f.key, v)} optional={optionalLabel} />;
        return (
          <Field
            key={f.key}
            label={f.required ? f.label : `${f.label} (${optionalLabel})`}
            value={value}
            onChangeText={(v) => onChange(f.key, v)}
            placeholder={f.placeholder}
            keyboardType={f.type === 'number' ? 'number-pad' : /host|url|ip|address/i.test(f.key) ? 'url' : 'default'}
            autoCapitalize="none"
            autoCorrect={false}
            missing={missing?.has(f.key)}
            hint={f.help}
          />
        );
      })}
    </View>
  );
}

export function initialValues(fields: FieldDef[], seed: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const opts = optionList(f);
    out[f.key] = seed[f.key] ?? f.default ?? (f.type === 'select' ? (opts[0]?.value ?? '') : '');
  }
  return out;
}

export function missingFields(fields: FieldDef[], values: Record<string, string>): Set<string> {
  return new Set(fields.filter((f) => f.required && !String(values[f.key] ?? '').trim()).map((f) => f.key));
}

export function Stepper({ value, onChange, min = 0, max = 9999, step = 1, suffix, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string; label: string }) {
  const c = useColors();
  const set = (v: number) => {
    tap();
    onChange(Math.min(max, Math.max(min, v)));
  };
  return (
    <View style={styles.stepper} accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ now: value, min, max }}>
      <Pressable onPress={() => set(value - step)} disabled={value <= min} hitSlop={6} style={[styles.stepBtn, { backgroundColor: c.surfaceSunken, opacity: value <= min ? 0.4 : 1 }]}>
        <Icon name="minus" size={14} color={c.text} />
      </Pressable>
      <Text style={[type.bodyStrong, styles.stepValue, { color: c.text }]}>
        {value}
        {suffix ? <Text style={[type.callout, { color: c.textSecondary }]}> {suffix}</Text> : null}
      </Text>
      <Pressable onPress={() => set(value + step)} disabled={value >= max} hitSlop={6} style={[styles.stepBtn, { backgroundColor: c.surfaceSunken, opacity: value >= max ? 0.4 : 1 }]}>
        <Icon name="plus" size={14} color={c.text} />
      </Pressable>
    </View>
  );
}

export function SliderDots({ value, onChange, min = 1, max = 10, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label: string }) {
  const c = useColors();
  const items = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  return (
    <View style={styles.dots} accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ now: value, min, max }}>
      {items.map((v) => (
        <Pressable
          key={v}
          onPress={() => {
            tap();
            onChange(v);
          }}
          hitSlop={4}
          style={[styles.dotCell, { backgroundColor: v <= value ? c.accent : c.surfaceSunken }]}
        />
      ))}
    </View>
  );
}

export function Ring({ fraction, size = 92, stroke = 10, color, track }: { fraction: number; size?: number; stroke?: number; color: string; track: string }) {
  const r = (size - stroke) / 2;
  const f = Math.max(0, Math.min(1, fraction));
  const angle = f * 2 * Math.PI;
  const cx = size / 2;
  const x = cx + r * Math.sin(angle);
  const y = cx - r * Math.cos(angle);
  const large = angle > Math.PI ? 1 : 0;
  return (
    <Svg width={size} height={size}>
      <Circle cx={cx} cy={cx} r={r} stroke={track} strokeWidth={stroke} fill="none" />
      {f >= 0.999 ? (
        <Circle cx={cx} cy={cx} r={r} stroke={color} strokeWidth={stroke} fill="none" />
      ) : f > 0 ? (
        <Path d={`M ${cx} ${cx - r} A ${r} ${r} 0 ${large} 1 ${x} ${y}`} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" />
      ) : null}
    </Svg>
  );
}

export function Bar({ fraction, color, track, height = 8 }: { fraction: number; color: string; track: string; height?: number }) {
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: track, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%`, height, borderRadius: height / 2, backgroundColor: color }} />
    </View>
  );
}

export function QrCode({ value, size = 220 }: { value: string; size?: number }) {
  const matrix = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) d += `M${col} ${r}h1v1h-1z`;
    return { n, d };
  }, [value]);
  const quiet = 2;
  return (
    <Svg width={size} height={size} viewBox={`${-quiet} ${-quiet} ${matrix.n + quiet * 2} ${matrix.n + quiet * 2}`}>
      <Rect x={-quiet} y={-quiet} width={matrix.n + quiet * 2} height={matrix.n + quiet * 2} fill="#fff" />
      <Path d={matrix.d} fill="#0B0D10" />
    </Svg>
  );
}

export function CodeBox({ code }: { code: string }) {
  const c = useColors();
  return (
    <View style={[styles.code, { backgroundColor: c.surfaceSunken, borderColor: c.border }]}>
      <Text style={[styles.codeText, { color: c.text }]} selectable adjustsFontSizeToFit numberOfLines={1}>
        {code}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { height: 36, paddingHorizontal: 14, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stepBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 64, textAlign: 'center', fontVariant: ['tabular-nums'] },
  dots: { flexDirection: 'row', gap: 4, flex: 1 },
  dotCell: { flex: 1, height: 22, borderRadius: 5 },
  code: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingVertical: space.lg, paddingHorizontal: space.lg, alignItems: 'center' },
  codeText: { fontFamily: fonts.bold, fontSize: 38, letterSpacing: 6, fontVariant: ['tabular-nums'] },
});
