import { Directory, File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';

const dir = () => {
  const d = new Directory(Paths.cache, 'exports');
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
};

const safe = (name: string) => name.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-');

export async function download(url: string, name: string, token?: string | null): Promise<File> {
  const file = new File(dir(), safe(name));
  if (file.exists) file.delete();
  return File.downloadFileAsync(url, file, { idempotent: true, headers: token ? { Authorization: `Bearer ${token}` } : undefined });
}

export class PermissionDenied extends Error {
  constructor() {
    super('permission-denied');
  }
}

export async function saveToPhotos(uri: string) {
  let perm = await MediaLibrary.getPermissionsAsync(true);
  if (!perm.granted && perm.canAskAgain) perm = await MediaLibrary.requestPermissionsAsync(true);
  if (!perm.granted) throw new PermissionDenied();
  await MediaLibrary.saveToLibraryAsync(uri);
}

export async function share(uri: string, kind: 'image' | 'video', title?: string) {
  if (!(await Sharing.isAvailableAsync())) return;
  await Sharing.shareAsync(uri, {
    mimeType: kind === 'image' ? 'image/jpeg' : 'video/mp4',
    UTI: kind === 'image' ? 'public.jpeg' : 'public.mpeg-4',
    dialogTitle: title,
  });
}

export function fileStamp(t = Date.now()) {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
