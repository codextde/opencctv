import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { Button, Field, IconButton, Notice, success } from '@/components/ui';
import { useT } from '@/i18n';
import { ApiError, publicApi } from '@/lib/api';
import { isDemoUrl } from '@/lib/config';
import { deviceName, gatewaySiteCount, saveConnection } from '@/lib/onboarding';
import type { ServerInfo } from '@/lib/types';
import { hostOf, isValidBaseUrl, normalizeBaseUrl } from '@/lib/url';
import { useServers } from '@/store/servers';
import { radius, space, type, useColors } from '@/theme';

type Step = 'url' | 'login' | 'setup';

export default function Connect() {
  const params = useLocalSearchParams<{ server?: string; user?: string; relogin?: string }>();
  const { t } = useT();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('url');
  const [url, setUrl] = useState(params.server ?? '');
  const [base, setBase] = useState('');
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [username, setUsername] = useState(params.user ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userRef = useRef<TextInput>(null);
  const pwRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const describe = (e: unknown) => {
    if (e instanceof ApiError) {
      if (e.status === 0) return e.code === 'timeout' ? t('connect.errTimeout') : t('connect.errNetwork');
      if (e.status === 401 || e.status === 403) return t('connect.errCredentials');
      if (e.status === 404) return t('connect.errNotOpenCctv');
      if (e.status === 429) return t('connect.errRateLimit');
      return e.message;
    }
    return e instanceof Error ? e.message : String(e);
  };

  const checkServer = async () => {
    const normalized = normalizeBaseUrl(url);
    if (!isValidBaseUrl(normalized)) {
      setError(t('connect.errUrl'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const i = await publicApi.info(normalized);
      if (!i || typeof i.version !== 'string') throw new ApiError(404, 'not opencctv');
      setBase(normalized);
      setInfo(i);
      setStep(i.setupRequired ? 'setup' : 'login');
      setTimeout(() => (username.trim() ? pwRef : userRef).current?.focus(), 350);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!username.trim() || !password) {
      setError(t('connect.errMissing'));
      return;
    }
    if (step === 'setup' && password !== confirm) {
      setError(t('connect.errMismatch'));
      return;
    }
    if (step === 'setup' && password.length < 8) {
      setError(t('connect.errShort'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const auth = step === 'setup' ? await publicApi.setup(base, username.trim(), password) : await publicApi.login(base, username.trim(), password, info && !info.demo && !isDemoUrl(base) ? deviceName() : undefined);
      const server = await saveConnection(base, auth, info, { demo: isDemoUrl(base) || !!info?.demo });
      success();
      const sites = await gatewaySiteCount(server, auth.token);
      if (sites > 0) router.replace({ pathname: '/sites', params: { gateway: server.id } });
      else router.dismissTo('/');
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  };

  const hasServers = useServers((s) => s.servers.length > 0);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: Platform.OS === 'android' ? insets.top + space.lg : space.xl, paddingBottom: insets.bottom + space.xl }]} keyboardShouldPersistTaps="handled">
        <View style={styles.top}>
          {step !== 'url' ? (
            <IconButton icon="chevronLeft" label={t('common.back')} onPress={() => setStep('url')} />
          ) : (
            <View style={{ width: 40 }} />
          )}
          <IconButton icon="close" label={t('common.close')} onPress={() => (router.canGoBack() ? router.back() : router.replace(hasServers ? '/' : '/welcome'))} />
        </View>

        {step === 'url' ? (
          <Animated.View entering={FadeIn} style={styles.step}>
            <View style={[styles.badge, { backgroundColor: c.accentSoft }]}>
              <Icon name="server" size={24} color={c.accentStrong} />
            </View>
            <Text style={[type.title, { color: c.text }]}>{t('connect.title')}</Text>
            <Text style={[type.body, { color: c.textSecondary }]}>{t('connect.body')}</Text>
            <Field
              label={t('connect.url')}
              placeholder="https://cams.example.com"
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              textContentType="URL"
              returnKeyType="next"
              onSubmitEditing={checkServer}
              autoFocus={!params.server}
              hint={t('connect.urlHint')}
            />
            {error ? <Notice tone="danger" icon="warning" title={error} /> : null}
            <Button title={t('common.continue')} onPress={checkServer} loading={busy} disabled={!url.trim()} />
            <Button title={t('welcome.scan')} icon="qr" variant="ghost" onPress={() => router.push('/scan')} />
          </Animated.View>
        ) : (
          <Animated.View entering={FadeIn} style={styles.step}>
            <View style={[styles.serverChip, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={[styles.dot, { backgroundColor: c.accent }]} />
              <View style={{ flex: 1 }}>
                <Text style={[type.bodyStrong, { color: c.text }]} numberOfLines={1}>
                  {info?.name || hostOf(base)}
                </Text>
                <Text style={[type.caption, { color: c.textSecondary }]} numberOfLines={1}>
                  {hostOf(base)}
                  {info?.version ? `  ·  v${info.version}` : ''}
                </Text>
              </View>
            </View>
            <Text style={[type.title, { color: c.text }]}>{step === 'setup' ? t('connect.setupTitle') : t('connect.loginTitle')}</Text>
            <Text style={[type.body, { color: c.textSecondary }]}>{step === 'setup' ? t('connect.setupBody') : t('connect.loginBody')}</Text>
            <Field
              ref={userRef}
              label={t('connect.username')}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="username"
              autoComplete="username"
              returnKeyType="next"
              onSubmitEditing={() => pwRef.current?.focus()}
            />
            <Field
              ref={pwRef}
              label={t('connect.password')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPw}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType={step === 'setup' ? 'newPassword' : 'password'}
              autoComplete={step === 'setup' ? 'new-password' : 'current-password'}
              returnKeyType={step === 'setup' ? 'next' : 'go'}
              onSubmitEditing={() => (step === 'setup' ? confirmRef.current?.focus() : submit())}
              right={<IconButton icon={showPw ? 'eyeOff' : 'eye'} size={32} label={t('connect.showPassword')} onPress={() => setShowPw((v) => !v)} style={{ backgroundColor: 'transparent' }} />}
              hint={step === 'setup' ? t('connect.passwordHint') : undefined}
            />
            {step === 'setup' ? (
              <Field
                ref={confirmRef}
                label={t('connect.confirm')}
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry={!showPw}
                autoCapitalize="none"
                textContentType="newPassword"
                returnKeyType="go"
                onSubmitEditing={submit}
              />
            ) : null}
            {error ? <Notice tone="danger" icon="warning" title={error} /> : null}
            <Button title={step === 'setup' ? t('connect.createAdmin') : t('connect.signIn')} onPress={submit} loading={busy} />
          </Animated.View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.xl, gap: space.lg, flexGrow: 1 },
  top: { flexDirection: 'row', justifyContent: 'space-between' },
  step: { gap: space.lg },
  badge: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  serverChip: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
