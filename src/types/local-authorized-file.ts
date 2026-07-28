export interface LocalAuthorizedFileEntry {
  entryId: string;
  entryType: 'file' | 'folder';
  parentEntryId: string;
  name: string;
  path: string;
  mimeType: string | null;
  fileExt: string | null;
  fileSize: number;
  createdAt: string | null;
  updatedAt: string | null;
  authorizedAt: string;
  missing?: boolean;
}

export interface LocalAuthorizedFileBreadcrumb {
  entryId: string;
  name: string;
}

export interface LocalAuthorizedFileStats {
  authorizedCount: number;
  folderCount: number;
  uncategorizedFileCount: number;
}

export interface LocalAuthorizedFilesResult {
  items: LocalAuthorizedFileEntry[];
  total: number;
  breadcrumbs: LocalAuthorizedFileBreadcrumb[];
  stats: LocalAuthorizedFileStats;
  canceled?: boolean;
}
