/** 可选来源：区分本地与数据中心文件（发送仍用 stagedPath）。 */
export type FileProvenance =
  | { kind: 'local' }
  | {
    kind: 'data_center';
    spaceType: 'drive' | 'qa_artifact' | 'site_shared_artifact';
    spaceId?: string | null;
    entryId: string;
  };

export interface FileAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  stagedPath: string; // disk path for gateway
  preview: string | null; // data URL for images, null for others
  status: 'staging' | 'ready' | 'error';
  error?: string;
  /** 可选溯源；本地上传可省略或写 `{ kind: 'local' }`。 */
  provenance?: FileProvenance;
}
