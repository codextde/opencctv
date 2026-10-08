import type { IconName } from '@/components/icon-names';

import type { StorageType } from './types';

export const storageIcon: Record<StorageType, IconName> = {
  local: 'disk',
  gdrive: 'cloud',
  s3: 'cloud',
  ftp: 'folder',
  sftp: 'lock',
  smb: 'folder',
  webdav: 'globe',
  dropbox: 'cloud',
  onedrive: 'cloud',
};
