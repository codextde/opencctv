import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { Platform } from 'react-native';

import { useT } from '@/i18n';
import { useConnection } from '@/lib/connection';
import { useLiveUpdates } from '@/lib/live-updates';
import { useColors } from '@/theme';

const android = Platform.OS === 'android';

export default function TabsLayout() {
  const c = useColors();
  const { t } = useT();
  const { isAdmin } = useConnection();
  useLiveUpdates();
  return (
    <NativeTabs
      tintColor={c.accentStrong}
      minimizeBehavior="onScrollDown"
      backgroundColor={android ? c.surface : undefined}
      indicatorColor={android ? c.accentSoft : undefined}
      iconColor={android ? { default: c.textSecondary, selected: c.accentStrong } : undefined}
      labelStyle={android ? { default: { color: c.textSecondary }, selected: { color: c.text } } : undefined}
      rippleColor={android ? c.accentSoft : undefined}
      labelVisibilityMode="labeled">
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>{t('tabs.live')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'video', selected: 'video.fill' }} md="videocam" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="playback">
        <NativeTabs.Trigger.Label>{t('tabs.playback')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'play.rectangle.on.rectangle', selected: 'play.rectangle.on.rectangle.fill' }} md="video_library" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="events">
        <NativeTabs.Trigger.Label>{t('tabs.events')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'bell', selected: 'bell.fill' }} md="notifications" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="manage" hidden={!isAdmin}>
        <NativeTabs.Trigger.Label>{t('tabs.manage')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="server.rack" md="dns" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>{t('tabs.settings')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} md="settings" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
