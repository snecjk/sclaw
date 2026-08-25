/**
 * 数据中心选文件公用弹窗。
 * 调用方只需传 `type` + open/close/confirm；
 * 确认时组件内 download+stage，`onConfirm` 抛出本地 stagedPath。
 */
export { DataCenterFilePickerModal } from './DataCenterFilePickerModal';
export type { DataCenterFilePickerModalProps } from './DataCenterFilePickerModal';
export type {
  DataCenterFilePickerType,
  DataCenterPickerSelection,
  DataCenterStagedFile,
} from './types';
