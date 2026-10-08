import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DynamicForm, initialValues, missingFields, OptionChips } from '@/components/forms';
import { Icon } from '@/components/icon';
import { toast } from '@/components/toast';
import { Button, Field, Group, IconButton, Loading, Notice, Row, success } from '@/components/ui';
import { useT } from '@/i18n';
import { useApi } from '@/lib/connection';
import { invalidate } from '@/lib/query';
import type { Brand, Camera, CameraTestResult, DiscoveryCandidate } from '@/lib/types';
import { radius, space, type, useColors } from '@/theme';

type Step = { kind: 'pick' } | { kind: 'form'; brand: Brand; seed?: DiscoveryCandidate } | { kind: 'unifi' } | { kind: 'done'; camera: Camera; snapshot?: string };

const HOST_KEYS = ['host', 'ip', 'address', 'hostname'];

export default function AddCamera() {
  const { t } = useT();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { api, scope } = useApi();
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [brandError, setBrandError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<DiscoveryCandidate[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [query, setQuery] = useState('');

  const loadBrands = () => {
    setBrandError(null);
    api
      .brands()
      .then(setBrands)
      .catch((e) => setBrandError(e instanceof Error ? e.message : String(e)));
  };

  const scan = async () => {
    setScanning(true);
    try {
      const res = await api.discover();
      setCandidates(res.candidates ?? []);
    } catch {
      setCandidates([]);
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    loadBrands();
    scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => router.back();
  const back = () => setStep({ kind: 'pick' });

  const pickCandidate = (cand: DiscoveryCandidate) => {
    if (!brands) return;
    const brand = brands.find((b) => b.id === cand.brand) ?? brands.find((b) => b.id === (cand.onvif ? 'onvif' : 'generic')) ?? brands[0];
    if (brand) setStep({ kind: 'form', brand, seed: cand });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (brands ?? []).filter((b) => b.id !== 'demo' && (!q || b.name.toLowerCase().includes(q)));
  }, [brands, query]);

  const title = step.kind === 'pick' ? t('add.title') : step.kind === 'form' ? step.brand.name : step.kind === 'unifi' ? t('add.unifi') : t('add.doneTitle');

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.header, { paddingTop: Platform.OS === 'android' ? insets.top + space.md : space.lg }]}>
        {step.kind === 'form' || step.kind === 'unifi' ? <IconButton icon="chevronLeft" label={t('common.back')} onPress={back} /> : <View style={{ width: 40 }} />}
        <Text style={[type.headline, { color: c.text, flex: 1, textAlign: 'center' }]} numberOfLines={1}>
          {title}
        </Text>
        <IconButton icon="close" label={t('common.close')} onPress={close} />
      </View>

      {step.kind === 'pick' ? (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]} keyboardShouldPersistTaps="handled">
          <View style={styles.sectionHead}>
            <Text style={[type.label, { color: c.textTertiary }]}>{t('add.discovered')}</Text>
            <Pressable onPress={scan} disabled={scanning} hitSlop={8} style={styles.rescan}>
              {scanning ? <ActivityIndicator size="small" color={c.accentStrong} /> : <Icon name="refresh" size={13} color={c.accentStrong} />}
              <Text style={[type.caption, { color: c.accentStrong }]}>{scanning ? t('add.scanning') : t('add.rescan')}</Text>
            </Pressable>
          </View>
          <Group>
            {candidates === null || (scanning && !candidates.length) ? (
              <View style={styles.scanBox}>
                <ActivityIndicator color={c.accentStrong} />
                <Text style={[type.callout, { color: c.textSecondary }]}>{t('add.scanningBody')}</Text>
              </View>
            ) : candidates.length === 0 ? (
              <View style={styles.scanBox}>
                <Icon name="radar" size={20} color={c.textTertiary} />
                <Text style={[type.callout, { color: c.textSecondary, textAlign: 'center' }]}>{t('add.noneFound')}</Text>
              </View>
            ) : (
              candidates.map((cand, i) => (
                <Row
                  key={`${cand.host}:${cand.port}`}
                  icon="camera"
                  title={cand.name || cand.model || cand.host}
                  subtitle={[cand.brand ? (brands?.find((b) => b.id === cand.brand)?.name ?? cand.brand) : null, `${cand.host}:${cand.port}`, cand.onvif ? 'ONVIF' : cand.rtsp ? 'RTSP' : null].filter(Boolean).join(' · ')}
                  value={cand.alreadyAdded ? t('add.alreadyAdded') : undefined}
                  onPress={cand.alreadyAdded ? undefined : () => pickCandidate(cand)}
                  last={i === candidates.length - 1}
                />
              ))
            )}
          </Group>

          <Group title={t('add.integrations')}>
            <Row icon="gateway" title={t('add.unifi')} subtitle={t('add.unifiHint')} onPress={() => setStep({ kind: 'unifi' })} last />
          </Group>

          <Text style={[type.label, { color: c.textTertiary, marginBottom: space.sm, marginHorizontal: space.xs }]}>{t('add.brands')}</Text>
          <Field label="" placeholder={t('add.searchBrand')} value={query} onChangeText={setQuery} autoCorrect={false} right={<Icon name="search" size={15} color={c.textTertiary} />} />
          <View style={{ height: space.md }} />
          {brandError ? <Notice tone="danger" icon="warning" title={t('add.brandsFailed')} body={brandError} action={t('common.retry')} onAction={loadBrands} /> : null}
          {!brands && !brandError ? <Loading /> : null}
          <View style={styles.brandGrid}>
            {filtered.map((b, i) => (
              <Animated.View key={b.id} entering={FadeInDown.delay(Math.min(i, 12) * 25)} style={styles.brandCell}>
                <Pressable onPress={() => setStep({ kind: 'form', brand: b })} style={({ pressed }) => [styles.brand, { backgroundColor: pressed ? c.surfacePressed : c.surface, borderColor: c.border }]} accessibilityRole="button">
                  <View style={[styles.brandMark, { backgroundColor: c.accentSoft }]}>
                    <Text style={[type.bodyStrong, { color: c.accentStrong }]}>{b.name.slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <Text style={[type.callout, { color: c.text, flex: 1 }]} numberOfLines={1}>
                    {b.name}
                  </Text>
                </Pressable>
              </Animated.View>
            ))}
          </View>
        </ScrollView>
      ) : null}

      {step.kind === 'form' ? (
        <BrandForm
          key={step.brand.id + (step.seed?.host ?? '')}
          brand={step.brand}
          seed={step.seed}
          onCreated={(camera, snapshot) => {
            invalidate(`${scope}cameras`);
            setStep({ kind: 'done', camera, snapshot });
          }}
        />
      ) : null}

      {step.kind === 'unifi' ? <UnifiImport onDone={() => invalidate(`${scope}cameras`)} /> : null}

      {step.kind === 'done' ? (
        <Animated.View entering={FadeIn} style={[styles.content, { flex: 1, paddingBottom: insets.bottom + space.xl }]}>
          <View style={[styles.doneHero, { backgroundColor: c.tile }]}>
            {step.snapshot ? (
              <Image source={{ uri: `data:image/jpeg;base64,${step.snapshot}` }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <Image source={{ uri: api.snapshotUrl(step.camera.id, 960) }} style={StyleSheet.absoluteFill} contentFit="cover" />
            )}
          </View>
          <View style={{ alignItems: 'center', gap: space.sm, marginVertical: space.xl }}>
            <Icon name="checkCircle" size={34} color={c.accentStrong} />
            <Text style={[type.title, { color: c.text, textAlign: 'center' }]}>{t('add.doneTitle')}</Text>
            <Text style={[type.body, { color: c.textSecondary, textAlign: 'center' }]}>{t('add.doneBody', { name: step.camera.name })}</Text>
          </View>
          {step.camera.push?.url ? (
            <Notice
              tone="info"
              icon="link"
              title={t('add.pushTitle')}
              body={step.camera.push.url}
              action={t('common.copy')}
              onAction={async () => {
                await Clipboard.setStringAsync(step.camera.push!.url);
                toast(t('common.copied'));
              }}
            />
          ) : null}
          <View style={{ flex: 1 }} />
          <View style={{ gap: space.sm }}>
            <Button
              title={t('add.openLive')}
              icon="live"
              onPress={() => {
                router.back();
                setTimeout(() => router.push(`/camera/${step.camera.id}`), 350);
              }}
            />
            <Button title={t('add.another')} variant="secondary" onPress={() => setStep({ kind: 'pick' })} />
          </View>
        </Animated.View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function BrandForm({ brand, seed, onCreated }: { brand: Brand; seed?: DiscoveryCandidate; onCreated: (camera: Camera, snapshot?: string) => void }) {
  const { t } = useT();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { api } = useApi();
  const kinds = brand.kinds?.length ? brand.kinds : [];
  const [kind, setKind] = useState(kinds[0] ?? '');
  const [name, setName] = useState(seed?.name || '');
  const seedValues = useMemo(() => {
    const out: Record<string, string> = {};
    if (!seed) return out;
    for (const f of brand.fields) {
      if (HOST_KEYS.includes(f.key.toLowerCase())) out[f.key] = seed.host;
      if (f.key.toLowerCase() === 'port' && seed.port && !seed.onvif) out[f.key] = String(seed.port);
    }
    return out;
  }, [brand, seed]);
  const [values, setValues] = useState(() => initialValues(brand.fields, seedValues));
  const [test, setTest] = useState<CameraTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const missing = missingFields(brand.fields, values);

  const body = () => {
    const fields = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ''));
    const isGenericUrl = brand.id === 'generic' && fields.url;
    return isGenericUrl
      ? { name: name.trim() || brand.name, brand: 'generic', url: fields.url, subUrl: fields.subUrl || undefined, kind: kind || undefined, fields }
      : { name: name.trim() || brand.name, brand: brand.id, kind: kind || undefined, fields };
  };

  const runTest = async () => {
    if (missing.size) {
      setShowMissing(true);
      return;
    }
    setTesting(true);
    setError(null);
    setTest(null);
    try {
      const res = await api.testCamera(body());
      setTest(res);
      if (res.ok) success();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const create = async () => {
    if (missing.size || !name.trim()) {
      setShowMissing(true);
      if (!name.trim()) setError(t('add.nameRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const cam = await api.createCamera(body());
      success();
      onCreated(cam, test?.snapshot);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl, gap: space.lg }]} keyboardShouldPersistTaps="handled">
      {brand.help ? <Notice tone="info" icon="info" title={t('add.howTo', { brand: brand.name })} body={brand.help} /> : null}
      {seed ? <Notice tone="good" icon="radar" title={t('add.fromDiscovery')} body={`${seed.host}:${seed.port}${seed.model ? ` · ${seed.model}` : ''}`} /> : null}
      <Field label={t('cameras.name')} value={name} onChangeText={setName} placeholder={t('add.namePlaceholder')} missing={showMissing && !name.trim()} />
      {kinds.length > 1 ? (
        <View style={{ gap: 6 }}>
          <Text style={[type.caption, { color: c.textSecondary }]}>{t('add.connectionType')}</Text>
          <OptionChips options={kinds.map((k) => ({ value: k, label: k.toUpperCase() }))} value={kind} onChange={setKind} />
        </View>
      ) : null}
      <DynamicForm fields={brand.fields} values={values} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} optionalLabel={t('common.optional')} missing={showMissing ? missing : undefined} />

      {test ? (
        <Animated.View entering={FadeIn} style={[styles.testCard, { backgroundColor: c.surface, borderColor: test.ok ? c.accent : c.danger }]}>
          {test.snapshot ? <Image source={{ uri: `data:image/jpeg;base64,${test.snapshot}` }} style={styles.testImage} contentFit="cover" /> : null}
          <View style={{ padding: space.md, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name={test.ok ? 'checkCircle' : 'warning'} size={16} color={test.ok ? c.accentStrong : c.danger} />
              <Text style={[type.bodyStrong, { color: c.text }]}>{test.ok ? t('add.testOk') : t('add.testFailed')}</Text>
            </View>
            <Text style={[type.caption, { color: c.textSecondary }]}>
              {test.ok
                ? [test.codec?.toUpperCase(), test.width && test.height ? `${test.width}×${test.height}` : null, test.audio ? t('add.withAudio') : null].filter(Boolean).join(' · ')
                : test.error}
            </Text>
          </View>
        </Animated.View>
      ) : null}
      {error ? <Notice tone="danger" icon="warning" title={error} /> : null}
      <View style={{ gap: space.sm }}>
        <Button title={t('add.test')} icon="bolt" variant="secondary" onPress={runTest} loading={testing} />
        <Button title={t('add.add')} onPress={create} loading={saving} />
      </View>
    </ScrollView>
  );
}

function UnifiImport({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { api } = useApi();
  const [host, setHost] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; name: string; model: string; added: boolean }[] | null>(null);

  const run = async () => {
    if (!host.trim() || !username.trim() || !password) {
      setError(t('connect.errMissing'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.unifiImport({ host: host.trim(), username: username.trim(), password });
      setResult(res.cameras ?? []);
      success();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl, gap: space.lg }]} keyboardShouldPersistTaps="handled">
      <Notice tone="info" icon="info" title={t('add.unifi')} body={t('add.unifiBody')} />
      <Field label={t('add.unifiHost')} value={host} onChangeText={setHost} placeholder="192.168.1.1" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
      <Field label={t('connect.username')} value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} />
      <Field label={t('connect.password')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
      {error ? <Notice tone="danger" icon="warning" title={error} /> : null}
      {result ? (
        <Group title={t('add.imported', { n: result.filter((r) => r.added).length })}>
          {result.map((r, i) => (
            <Row
              key={r.id}
              icon={r.added ? 'checkCircle' : 'camera'}
              title={r.name}
              subtitle={r.model}
              value={r.added ? t('add.added') : t('add.alreadyAdded')}
              last={i === result.length - 1}
            />
          ))}
        </Group>
      ) : null}
      {result ? <Button title={t('common.done')} onPress={() => router.back()} /> : <Button title={t('add.import')} onPress={run} loading={busy} />}
      <Text style={[type.caption, { color: c.textTertiary }]}>{t('add.unifiPrivacy')}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.md },
  content: { paddingHorizontal: space.lg, paddingTop: space.md },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm, marginHorizontal: space.xs },
  rescan: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  scanBox: { padding: space.xl, alignItems: 'center', gap: space.sm },
  brandGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.xs },
  brandCell: { width: '50%', padding: space.xs },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, minHeight: 52 },
  brandMark: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  testCard: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  testImage: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  doneHero: { aspectRatio: 16 / 9, borderRadius: radius.lg, overflow: 'hidden', marginTop: space.md },
});
