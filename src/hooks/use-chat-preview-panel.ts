import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AttachedFileMeta, RawMessage } from '@/stores/chat';
import { useSessionWorkflowPreview } from '@/hooks/use-session-workflow-preview';
import { filterSessionWorkflowCardStates } from '@/lib/session-workflow-context';
import { usePreviewableFiles } from '@/pages/Chat/message-utils';
import { logFilePreview } from '@/lib/file-preview-debug';

export function useChatPreviewPanel(allMessages: RawMessage[], sessionKey: string) {
  const [showPreviewPanel, setShowPreviewPanel] = useState(false);
  const [activePreviewFilePath, setActivePreviewFilePath] = useState<string | null>(null);
  /** Files opened on demand (e.g. workflow fallback URL) — not always present in message scan. */
  const [extraPreviewFiles, setExtraPreviewFiles] = useState<AttachedFileMeta[]>([]);
  /** 本次视图内关闭的产物 tab，不影响消息里的产物卡 */
  const [dismissedFilePaths, setDismissedFilePaths] = useState<Set<string>>(() => new Set());

  const sessionWorkflowCardStates = useMemo(
    () => filterSessionWorkflowCardStates(allMessages, {}),
    [allMessages],
  );

  const previewableFiles = usePreviewableFiles(allMessages, sessionWorkflowCardStates, sessionKey);

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

  const visiblePreviewFiles = useMemo(
    () => previewFiles.filter(
      (file): file is AttachedFileMeta & { filePath: string } => (
        file.filePath !== undefined
        && file.filePath !== null
        && file.filePath !== ''
        && !dismissedFilePaths.has(file.filePath)
      ),
    ),
    [previewFiles, dismissedFilePaths],
  );

  const {
    workflowId: sessionWorkflowId,
    showEditWorkflow,
  } = useSessionWorkflowPreview(allMessages, sessionKey);

  const canShowPreviewPanel = visiblePreviewFiles.length > 0;

  const prevSessionKeyRef = useRef(sessionKey);

  useEffect(() => {
    if (prevSessionKeyRef.current === sessionKey) return;
    prevSessionKeyRef.current = sessionKey;
    setShowPreviewPanel(false);
    setActivePreviewFilePath(null);
    setExtraPreviewFiles([]);
    setDismissedFilePaths(new Set());
  }, [sessionKey]);

  useEffect(() => {
    if (!showPreviewPanel) return;

    if (
      activePreviewFilePath !== null
      && !visiblePreviewFiles.some((file) => file.filePath === activePreviewFilePath)
    ) {
      const latest = visiblePreviewFiles[visiblePreviewFiles.length - 1];
      if (latest?.filePath) {
        setActivePreviewFilePath(latest.filePath);
        return;
      }
      setShowPreviewPanel(false);
      setActivePreviewFilePath(null);
    }
  }, [showPreviewPanel, activePreviewFilePath, visiblePreviewFiles]);

  const openPreviewPanel = useCallback(() => {
    const latestFile = visiblePreviewFiles[visiblePreviewFiles.length - 1];
    if (!latestFile?.filePath) return;
    setActivePreviewFilePath(latestFile.filePath);
    setShowPreviewPanel(true);
  }, [visiblePreviewFiles]);

  const openArtifactPreview = useCallback((file: AttachedFileMeta) => {
    if (!file.filePath) return;
    logFilePreview('open-artifact-preview', {
      filePath: file.filePath,
      fileName: file.fileName,
      mimeType: file.mimeType,
    });
    setDismissedFilePaths((prev) => {
      if (!prev.has(file.filePath!)) return prev;
      const next = new Set(prev);
      next.delete(file.filePath!);
      return next;
    });
    setExtraPreviewFiles((prev) => (
      prev.some((item) => item.filePath === file.filePath) ? prev : [...prev, file]
    ));
    setActivePreviewFilePath(file.filePath);
    setShowPreviewPanel(true);
  }, []);

  const closePreviewPanel = useCallback(() => {
    setShowPreviewPanel(false);
  }, []);

  const dismissPreviewFile = useCallback((filePath: string) => {
    setDismissedFilePaths((prevDismissed) => {
      const nextDismissed = new Set(prevDismissed);
      nextDismissed.add(filePath);

      setActivePreviewFilePath((currentActive) => {
        if (currentActive !== filePath) return currentActive;
        const remaining = previewFiles.filter(
          (file) => file.filePath !== undefined
            && file.filePath !== null
            && file.filePath !== filePath
            && !nextDismissed.has(file.filePath),
        );
        if (remaining.length === 0) {
          closePreviewPanel();
          return null;
        }
        return remaining[remaining.length - 1]?.filePath ?? null;
      });

      return nextDismissed;
    });
  }, [closePreviewPanel, previewFiles]);

  return {
    showPreviewPanel,
    setShowPreviewPanel,
    openPreviewPanel,
    activePreviewFilePath,
    setActivePreviewFilePath,
    previewableFiles: visiblePreviewFiles,
    canShowPreviewPanel,
    openArtifactPreview,
    closePreviewPanel,
    dismissPreviewFile,
    showEditWorkflow,
    workflowId: sessionWorkflowId,
  };
}
