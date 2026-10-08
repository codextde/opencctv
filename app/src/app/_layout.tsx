import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Appearance, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ActionSheetHost } from '@/components/action-sheet';
import { LockGate } from '@/components/lock-gate';
import { ToastHost } from '@/components/toast';
import { useT } from '@/i18n';
import { SCREENSHOT_MODE } from '@/lib/config';
import { iconFonts, textFonts } from '@/lib/fonts';
import { usePushRouting } from '@/lib/push';
import { useServers } from '@/store/servers';
import { useSettings } from '@/store/settings';
import { useColors, useIsDark } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ fade: true, duration: 250 });

export const unstable_settings = {
  anchor: '(tabs)',
};

function Navigator() {
  const hasServer = useServers((s) => s.servers.length > 0);
  const isAdmin = useServers((s) => (s.servers.find((x) => x.id === s.activeId) ?? s.servers[0])?.role === 'admin');
  const c = useColors();
  const dark = useIsDark();
  const { t } = useT();
  usePushRouting(hasServer);

  const base = dark ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: { ...base.colors, primary: c.accent, background: c.background, card: c.background, text: c.text, border: c.border },
  };
  const pushed = {
    headerShown: true,
    headerTransparent: Platform.OS === 'ios',
    headerStyle: Platform.OS === 'android' ? { backgroundColor: c.background } : undefined,
    headerTintColor: c.text,
    headerTitleStyle: { fontFamily: 'Inter_600SemiBold', color: c.text },
    headerShadowVisible: false,
    headerBackButtonDisplayMode: 'minimal' as const,
    headerLargeTitle: false,
  };
  const sheet = {
    presentation: 'formSheet' as const,
    sheetGrabberVisible: true,
    sheetCornerRadius: 28,
    contentStyle: { backgroundColor: c.background },
  };
  const modal = {
    presentation: 'modal' as const,
    contentStyle: { backgroundColor: c.background },
  };
  const video = {
    presentation: 'fullScreenModal' as const,
    animation: 'fade' as const,
    contentStyle: { backgroundColor: '#000' },
    autoHideHomeIndicator: true,
  };

  return (
    <ThemeProvider value={theme}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.background } }}>
        <Stack.Protected guard={hasServer}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="camera/[id]" options={video} />
          <Stack.Screen name="replay/[id]" options={video} />
        </Stack.Protected>
        <Stack.Protected guard={hasServer && isAdmin}>
          <Stack.Screen name="manage/cameras" options={{ ...pushed, title: t('manage.cameras') }} />
          <Stack.Screen name="manage/camera/[id]" options={{ ...pushed, title: '' }} />
          <Stack.Screen name="manage/add-camera" options={modal} />
          <Stack.Screen name="manage/storage" options={{ ...pushed, title: t('storage.title') }} />
          <Stack.Screen name="manage/storage-target" options={modal} />
          <Stack.Screen name="manage/users" options={{ ...pushed, title: t('users.title') }} />
          <Stack.Screen name="manage/user" options={{ ...sheet, sheetAllowedDetents: [0.7, 1] }} />
          <Stack.Screen name="manage/gateway" options={{ ...pushed, title: t('gateway.title') }} />
          <Stack.Screen name="manage/system" options={{ ...pushed, title: t('system.title') }} />
          <Stack.Screen name="manage/logs" options={{ ...pushed, title: t('system.logs') }} />
          <Stack.Screen name="manage/recording" options={{ ...pushed, title: t('serverSettings.title') }} />
          <Stack.Screen name="manage/pairing" options={{ ...sheet, sheetAllowedDetents: [0.75, 1] }} />
        </Stack.Protected>
        <Stack.Protected guard={hasServer}>
          <Stack.Screen name="settings/servers" options={{ ...pushed, title: t('servers.title') }} />
          <Stack.Screen name="settings/about" options={{ ...pushed, title: t('about.title') }} />
          <Stack.Screen name="settings/privacy" options={{ ...pushed, title: t('privacy.title') }} />
          <Stack.Screen name="settings/licenses" options={{ ...pushed, title: t('licenses.title') }} />
        </Stack.Protected>
        <Stack.Protected guard={!hasServer}>
          <Stack.Screen name="welcome" />
        </Stack.Protected>
        <Stack.Screen name="connect" options={modal} />
        <Stack.Screen name="scan" options={modal} />
        <Stack.Screen name="pair" options={modal} />
        <Stack.Screen name="sites" options={modal} />
        <Stack.Protected guard={SCREENSHOT_MODE}>
          <Stack.Screen name="shots" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({ ...textFonts, ...iconFonts });
  const [hydrated, setHydrated] = useState(useServers.persist.hasHydrated() && useSettings.persist.hasHydrated());
  const tokensLoaded = useServers((s) => s.tokensLoaded);
  const appearance = useSettings((s) => s.appearance);
  const [timedOut, setTimedOut] = useState(false);
  const c = useColors();

  useEffect(() => {
    Appearance.setColorScheme(appearance === 'system' ? 'unspecified' : appearance);
  }, [appearance]);

  useEffect(() => {
    if (hydrated) return;
    const check = () => {
      if (useServers.persist.hasHydrated() && useSettings.persist.hasHydrated()) setHydrated(true);
    };
    const a = useServers.persist.onFinishHydration(check);
    const b = useSettings.persist.onFinishHydration(check);
    check();
    return () => {
      a();
      b();
    };
  }, [hydrated]);

  useEffect(() => {
    if (hydrated && !tokensLoaded) useServers.getState().loadTokens();
  }, [hydrated, tokensLoaded]);

  useEffect(() => {
    const id = setTimeout(() => setTimedOut(true), 3000);
    return () => clearTimeout(id);
  }, []);

  const ready = ((loaded || !!error) && hydrated && tokensLoaded) || timedOut;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.background }}>
      <SafeAreaProvider>
        <Navigator />
        <ActionSheetHost />
        <ToastHost />
        <LockGate />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
