import { useCallback, useMemo, useState } from 'react';
import type { AttachedFileMeta, RawMessage } from '@/stores/chat';
import { useChatStore } from '@/stores/chat';
import { useSessionWorkflowPreview } from '@/hooks/use-session-workflow-preview';
import { usePreviewableFiles } from '@/pages/Chat/message-utils';

export type PreviewPanelTab = 'product' | 'workflow';

export function useChatPreviewPanel(allMessages: RawMessage[]) {
  const workflowCardStates = useChatStore((s) => s.workflowCardStates);

  const [showPreviewPanel, setShowPreviewPanel] = useState(false);
  const [activePreviewFilePath, setActivePreviewFilePath] = useState<string | null>(null);
  const [previewActiveTab, setPreviewActiveTab] = useState<PreviewPanelTab>('product');
  const [forcedWorkflowId, setForcedWorkflowId] = useState<string | null>(null);

  const previewableFiles = usePreviewableFiles(allMessages, workflowCardStates);

  const {
    workflowId: sessionWorkflowId,
    showWorkflowTab,
    detail: workflowDetail,
    loading: workflowLoading,
    error: workflowError,
  } = useSessionWorkflowPreview(allMessages, forcedWorkflowId);

  const canShowPreviewPanel = previewableFiles.length > 0 || showWorkflowTab;

  const openArtifactPreview = useCallback((file: AttachedFileMeta) => {
    if (!file.filePath) return;
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
    previewableFiles,
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
