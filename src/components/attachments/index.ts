export type { FileAttachment, FileProvenance } from './types';
export type {
  DataCenterPickerSelection,
  DataCenterStagedFile,
} from '@/components/data-center-file-picker';
export { AttachmentChips, formatFileSize, FileIcon } from './AttachmentChips';
export type { AttachmentChipsProps } from './AttachmentChips';
export {
  ATTACHMENT_CHIP_SURFACE_CLASS,
  middleEllipsisFileName,
  resolveFileTypeIconKind,
  resolveFileTypeIconSrc,
} from './file-type-icon';
export { useAttachmentStager } from './use-attachment-stager';
export { ComposerAttachMenu } from './ComposerAttachMenu';
export type { ComposerAttachMenuProps, ComposerAttachSource } from './ComposerAttachMenu';
export { useComposerAttachSource } from './use-composer-attach-source';
/** 兼容再导出：实现已迁至 `@/components/data-center-file-picker` */
export {
  DataCenterFilePickerModal,
} from '@/components/data-center-file-picker';
export type {
  DataCenterFilePickerModalProps,
  DataCenterFilePickerType,
} from '@/components/data-center-file-picker';
