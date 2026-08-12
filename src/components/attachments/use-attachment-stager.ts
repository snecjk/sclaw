import { useCallback, useState } from 'react';
import { hostApiFetch } from '@/lib/host-api';
import { invokeIpc } from '@/lib/api-client';
import { inferMimeTypeFromPath } from '@/lib/preview-url';
import type { FileAttachment, FileProvenance } from './types';

export type { FileProvenance };

export interface UseAttachmentStagerOptions {
  onAttachmentUpsert?: (att: FileAttachment) => void;
}

/**
 * Read a browser File object as base64 string (without the data URL prefix).
 */
function readFileAsBase64(file: globalThis.File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (!dataUrl || !dataUrl.includes(',')) {
        reject(new Error(`Invalid data URL from FileReader for ${file.name}`));
        return;
      }
      const base64 = dataUrl.split(',')[1];
      if (!base64) {
        reject(new Error(`Empty base64 data for ${file.name}`));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

const LOCAL_PROVENANCE: FileProvenance = { kind: 'local' };

/**
 * 双入口附件 stager：
 * - dialog → filePaths → /api/files/stage-paths
 * - 粘贴/拖拽 File[] → /api/files/stage-buffer
 */
export function useAttachmentStager(options?: UseAttachmentStagerOptions) {
  const { onAttachmentUpsert } = options ?? {};
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);

  const notifyUpsert = useCallback((att: FileAttachment) => {
    onAttachmentUpsert?.(att);
  }, [onAttachmentUpsert]);

  const upsertAttachment = useCallback((att: FileAttachment) => {
    setAttachments((prev) => {
      const idx = prev.findIndex((item) => item.id === att.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = att;
        return next;
      }
      return [...prev, att];
    });
    notifyUpsert(att);
  }, [notifyUpsert]);

  const replaceAttachments = useCallback((next: FileAttachment[]) => {
    setAttachments(next);
    for (const att of next) {
      notifyUpsert(att);
    }
  }, [notifyUpsert]);

  const setAttachmentsSilent = useCallback((next: FileAttachment[]) => {
    setAttachments(next);
  }, []);

  const pickFiles = useCallback(async () => {
    try {
      const result = await invokeIpc('dialog:open', {
        properties: ['openFile', 'multiSelections'],
      }) as { canceled: boolean; filePaths?: string[] };
      if (result.canceled || !result.filePaths?.length) return;

      const tempIds: string[] = [];
      for (const filePath of result.filePaths) {
        const tempId = crypto.randomUUID();
        tempIds.push(tempId);
        const fileName = filePath.split(/[\\/]/).pop() || 'file';
        upsertAttachment({
          id: tempId,
          fileName,
          mimeType: '',
          fileSize: 0,
          stagedPath: '',
          preview: null,
          status: 'staging',
          provenance: LOCAL_PROVENANCE,
        });
      }

      const staged = await hostApiFetch<Array<{
        id: string;
        fileName: string;
        mimeType: string;
        fileSize: number;
        stagedPath: string;
        preview: string | null;
      }>>('/api/files/stage-paths', {
        method: 'POST',
        body: JSON.stringify({ filePaths: result.filePaths }),
      });

      for (let i = 0; i < tempIds.length; i += 1) {
        const tempId = tempIds[i];
        const data = staged[i];
        if (data) {
          // 保留客户端 tempId，使注册表与行内 token 保持 1:1（API 会返回新 id）。
          upsertAttachment({
            ...data,
            id: tempId,
            status: 'ready',
            provenance: LOCAL_PROVENANCE,
          });
        } else {
          console.warn(`[pickFiles] No staged data for tempId=${tempId} at index ${i}`);
          setAttachments((prev) => {
            const existing = prev.find((item) => item.id === tempId);
            if (!existing) return prev;
            const updated: FileAttachment = {
              ...existing,
              status: 'error',
              error: 'Staging failed',
            };
            notifyUpsert(updated);
            return prev.map((item) => (item.id === tempId ? updated : item));
          });
        }
      }
    } catch (err) {
      console.error('[pickFiles] Failed to stage files:', err);
      setAttachments((prev) => prev.map((item) => {
        if (item.status !== 'staging') return item;
        const updated: FileAttachment = { ...item, status: 'error', error: String(err) };
        notifyUpsert(updated);
        return updated;
      }));
    } finally {
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
  }, [notifyUpsert, upsertAttachment]);

  const stageBufferFiles = useCallback(async (files: globalThis.File[]) => {
    for (const file of files) {
      const tempId = crypto.randomUUID();
      const mimeType = file.type || inferMimeTypeFromPath(file.name);
      upsertAttachment({
        id: tempId,
        fileName: file.name,
        mimeType,
        fileSize: file.size,
        stagedPath: '',
        preview: null,
        status: 'staging',
        provenance: LOCAL_PROVENANCE,
      });

      try {
        const base64 = await readFileAsBase64(file);
        const staged = await hostApiFetch<{
          id: string;
          fileName: string;
          mimeType: string;
          fileSize: number;
          stagedPath: string;
          preview: string | null;
        }>('/api/files/stage-buffer', {
          method: 'POST',
          body: JSON.stringify({
            base64,
            fileName: file.name,
            mimeType,
          }),
        });
        upsertAttachment({
          ...staged,
          id: tempId,
          status: 'ready',
          provenance: LOCAL_PROVENANCE,
        });
      } catch (err) {
        console.error(`[stageBuffer] Error staging ${file.name}:`, err);
        setAttachments((prev) => {
          const existing = prev.find((item) => item.id === tempId);
          if (!existing) return prev;
          const updated: FileAttachment = { ...existing, status: 'error', error: String(err) };
          notifyUpsert(updated);
          return prev.map((item) => (item.id === tempId ? updated : item));
        });
      }
    }
  }, [notifyUpsert, upsertAttachment]);

  const stageDataCenterFiles = useCallback(async (_entries: unknown[]) => {
    console.warn('[stageDataCenterFiles] not implemented yet');
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  const clearFailedAttachments = useCallback(() => {
    setAttachments((prev) => prev.filter((att) => att.status !== 'error'));
  }, []);

  const allReady = attachments.length === 0 || attachments.every((a) => a.status === 'ready');
  const hasFailedAttachments = attachments.some((a) => a.status === 'error');

  return {
    attachments,
    pickFiles,
    stageBufferFiles,
    stageDataCenterFiles,
    upsertAttachment,
    replaceAttachments,
    setAttachmentsSilent,
    removeAttachment,
    clearAttachments,
    clearFailedAttachments,
    allReady,
    hasFailedAttachments,
  };
}
