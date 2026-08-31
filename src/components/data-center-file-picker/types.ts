/**
 * 数据中心「选文件」公用弹窗的对外类型。
 * 调用方只需关心 `type`；确认后抛出已 stage 的本地路径。
 */

/** 弹窗数据源：与数据中心 spaceType 一一对应。 */
export type DataCenterFilePickerType = 'drive' | 'qa_artifact' | 'site_shared_artifact';

/**
 * 弹窗内部勾选态（确认前）。
 * 仅含数据中心元数据，尚无本地路径。
 */
export interface DataCenterPickerSelection {
  entryId: string;
  name: string;
  mimeType: string | null;
  fileSize: number;
  spaceType: DataCenterFilePickerType;
  spaceId?: string | null;
}

/**
 * 确认并下载/stage 成功后回传给调用方。
 * `stagedPath` 即本地 outbound 路径，可直接用于发送。
 */
export interface DataCenterStagedFile {
  entryId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  stagedPath: string;
  preview: string | null;
  spaceType: DataCenterFilePickerType;
  spaceId?: string | null;
}
