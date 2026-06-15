import { useCallback, useMemo, useState } from 'react';
import type { AttachedFileMeta, RawMessage } from '@/stores/chat';
import { useChatStore } from '@/stores/chat';
import { useSessionWorkflowPreview } from '@/hooks/use-session-workflow-preview';
import { usePreviewableFiles } from '@/pages/Chat/message-utils';
import { logFilePreview } from '@/lib/file-preview-debug';

export type PreviewPanelTab = 'product' | 'workflow';

export function useChatPreviewPanel(allMessages: RawMessage[]) {
  const workflowCardStates = useChatStore((s) => s.workflowCardStates);

  const [showPreviewPanel, setShowPreviewPanel] = useState(false);
  const [activePreviewFilePath, setActivePreviewFilePath] = useState<string | null>(null);
  const [previewActiveTab, setPreviewActiveTab] = useState<PreviewPanelTab>('product');
  const [forcedWorkflowId, setForcedWorkflowId] = useState<string | null>(null);
  /** Files opened on demand (e.g. workflow fallback URL) — not always present in message scan. */
  const [extraPreviewFiles, setExtraPreviewFiles] = useState<AttachedFileMeta[]>([]);

  const previewableFiles = usePreviewableFiles(allMessages, workflowCardStates);

  const previewFiles = useMemo(() => {
    const byPath = new Map<string, AttachedFileMeta>();
    for (const file of previewableFiles) {
      if (file.filePath) byPath.set(file.filePath, file);
    }
    for (const file of extraPreviewFiles) {
      if (file.filePath) byPath.set(file.filePath, file);
    }
    return Array.from(byPath.values());
  }, [previewableFiles, extraPreviewFiles]);

  const {
    workflowId: sessionWorkflowId,
    showWorkflowTab,
    detail: workflowDetail,
    loading: workflowLoading,
    error: workflowError,
  } = useSessionWorkflowPreview(allMessages, forcedWorkflowId);

  const canShowPreviewPanel = previewFiles.length > 0 || showWorkflowTab;

  const openArtifactPreview = useCallback((file: AttachedFileMeta) => {
    if (!file.filePath) return;
    logFilePreview('open-artifact-preview', {
      filePath: file.filePath,
      fileName: file.fileName,
      mimeType: file.mimeType,
    });
    setExtraPreviewFiles((prev) => (
      prev.some((item) => item.filePath === file.filePath) ? prev : [...prev, file]
    ));
    setActivePreviewFilePath(file.filePath);
    setPreviewActiveTab('product');
    setShowPreviewPanel(true);
  }, []);

  const openWorkflowPreview = useCallback((workflowId: string) => {
    setForcedWorkflowId(workflowId);
    setPreviewActiveTab('workflow');
    setShowPreviewPanel(true);
  }, []);

  const closePreviewPanel = useCallback(() => {
    setShowPreviewPanel(false);
  }, []);

  const activeWorkflowId = useMemo(
    () => forcedWorkflowId ?? sessionWorkflowId,
    [forcedWorkflowId, sessionWorkflowId],
  );

  return {
    showPreviewPanel,
    setShowPreviewPanel,
    activePreviewFilePath,
    setActivePreviewFilePath,
    previewActiveTab,
    setPreviewActiveTab,
    previewableFiles: previewFiles,
    canShowPreviewPanel,
    openArtifactPreview,
    openWorkflowPreview,
    closePreviewPanel,
    showWorkflowTab,
    workflowId: activeWorkflowId,
    workflowDetail,
    workflowLoading,
    workflowError,
  };
}
