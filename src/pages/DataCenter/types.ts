import type { DataCenterEntry } from '@/types/data-center';

export type DataCenterUiEntry = DataCenterEntry & {
  localAuthorized?: boolean;
  localPath?: string;
  missing?: boolean;
};

export type DriveTab = 'local' | 'upload';

export type UploadToSharedTarget = { entry: DataCenterUiEntry; targetSpaceId: string };

export interface EntryRenderProps {
  items: DataCenterUiEntry[];
  onOpenFolder: (entry: DataCenterUiEntry) => void;
  onPreview: (entry: DataCenterUiEntry) => void;
  onDownload: (entry: DataCenterUiEntry) => void;
  onShare: (entry: DataCenterUiEntry) => void;
  onUploadToShared: (entry: DataCenterUiEntry) => void;
  onMove: (entry: DataCenterUiEntry) => void;
  onMoveToFolder: (entry: DataCenterUiEntry, targetFolder: DataCenterUiEntry) => void;
  onRename: (entry: DataCenterUiEntry) => void;
  onDelete: (entry: DataCenterUiEntry) => void;
  onTrace: (entry: DataCenterUiEntry) => void;
}
