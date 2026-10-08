import * as Haptics from 'expo-haptics';
import { Alert, Linking } from 'react-native';

import { toast } from '@/components/toast';
import { t } from '@/i18n';

import type { ServerApi } from './api';
import { download, fileStamp, PermissionDenied, saveToPhotos, share } from './media';
import type { Camera } from './types';

function deniedAlert() {
  Alert.alert(t('media.deniedTitle'), t('media.deniedBody'), [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('common.openSettings'), onPress: () => Linking.openSettings() },
  ]);
}

export async function snapshotFile(api: ServerApi, camera: Camera) {
  return download(api.snapshotUrl(camera.id), `${camera.name}-${fileStamp()}.jpg`, api.token);
}

export async function saveSnapshot(api: ServerApi, camera: Camera) {
  try {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    const file = await snapshotFile(api, camera);
    await saveToPhotos(file.uri);
    toast(t('media.snapshotSaved'));
  } catch (e) {
    if (e instanceof PermissionDenied) deniedAlert();
    else toast(t('media.failed'), 'bad');
  }
}

export async function shareSnapshot(api: ServerApi, camera: Camera) {
  try {
    const file = await snapshotFile(api, camera);
    await share(file.uri, 'image', camera.name);
  } catch {
    toast(t('media.failed'), 'bad');
  }
}

export async function exportClip(api: ServerApi, camera: Camera, start: number, end: number, mode: 'save' | 'share') {
  const res = await api.clip(camera.id, new Date(start).toISOString(), new Date(end).toISOString());
  const file = await download(api.media(res.url), `${camera.name}-${fileStamp(start)}.mp4`, api.token);
  if (mode === 'share') {
    await share(file.uri, 'video', camera.name);
    return;
  }
  try {
    await saveToPhotos(file.uri);
    toast(t('media.clipSaved'));
  } catch (e) {
    if (e instanceof PermissionDenied) deniedAlert();
    else throw e;
  }
}
