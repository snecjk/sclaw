import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AttachedFileMeta, RawMessage } from '@/stores/chat';
import { useSessionWorkflowPreview } from '@/hooks/use-session-workflow-preview';
import { filterSessionWorkflowCardStates } from '@/lib/session-workflow-context';
import { usePreviewableFiles } from '@/pages/Chat/message-utils';
import { logFilePreview } from '@/lib/file-preview-debug';
import {
  useChatBrowserPreviewStore,
  type ChatBrowserPreviewTab,
} from '@/stores/chat-browser-preview';

/** Stable empty snapshot — never allocate `[]` inside a zustand selector. */
const EMPTY_BROWSER_TABS: ChatBrowserPreviewTab[] = [];

/** Workbench 预览布局：closed 双栏 / split 三栏 / expanded 预览占满 Workspace（非 DOM Fullscreen） */
export type PreviewMode = 'closed' | 'split' | 'expanded';

export function useChatPreviewPanel(allMessages: RawMessage[], sessionKey: string) {
  const [previewMode, setPreviewMode] = useState<PreviewMode>('closed');
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

  const browserTabs = useChatBrowserPreviewStore(
    (s) => s.tabsBySession[sessionKey] ?? EMPTY_BROWSER_TABS,
  );
  const hasBrowserPreview = browserTabs.length > 0;

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

  const canShowPreviewPanel = visiblePreviewFiles.length > 0 || hasBrowserPreview;
  const showPreviewPanel = previewMode !== 'closed';
  const isPreviewSplit = previewMode === 'split';
  const isPreviewExpanded = previewMode === 'expanded';

  const prevSessionKeyRef = useRef(sessionKey);

  useEffect(() => {
    if (prevSessionKeyRef.current === sessionKey) return;
    prevSessionKeyRef.current = sessionKey;
    setPreviewMode('closed');
    setActivePreviewFilePath(null);
    setExtraPreviewFiles([]);
    setDismissedFilePaths(new Set());
  }, [sessionKey]);

  useEffect(() => {
    if (browserTabs.length > 0 && previewMode === 'closed') {
      setPreviewMode('split');
    }
  }, [browserTabs.length, previewMode]);

  useEffect(() => {
    if (previewMode === 'closed') return;
    if (hasBrowserPreview) return;

    if (
      activePreviewFilePath !== null
      && !visiblePreviewFiles.some((file) => file.filePath === activePreviewFilePath)
    ) {
      const latest = visiblePreviewFiles[visiblePreviewFiles.length - 1];
      if (latest?.filePath) {
        // 产物列表收缩时把活跃 tab 同步到仍存在的文件。
        // eslint-disable-next-line react-hooks/set-state-in-effect -- sync active tab when file list shrinks
        setActivePreviewFilePath(latest.filePath);
        return;
      }
      setPreviewMode('closed');
      setActivePreviewFilePath(null);
    }
  }, [previewMode, activePreviewFilePath, visiblePreviewFiles, hasBrowserPreview]);

  const openPreviewPanel = useCallback(() => {
    if (hasBrowserPreview) {
      setPreviewMode('split');
      return;
    }
    const latestFile = visiblePreviewFiles[visiblePreviewFiles.length - 1];
    if (!latestFile?.filePath) return;
    setActivePreviewFilePath(latestFile.filePath);
    setPreviewMode('split');
  }, [visiblePreviewFiles, hasBrowserPreview]);

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
    setPreviewMode('split');
  }, []);

  const closePreviewPanel = useCallback(() => {
    setPreviewMode('closed');
  }, []);

  /** split → expanded；不改写 previewSplitPercent */
  const expandPreview = useCallback(() => {
    setPreviewMode((mode) => (mode === 'split' ? 'expanded' : mode));
  }, []);

  /** expanded → split；恢复上次持久化的 split percent（由 settings store 持有） */
  const restorePreview = useCallback(() => {
    setPreviewMode((mode) => (mode === 'expanded' ? 'split' : mode));
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
    previewMode,
    showPreviewPanel,
    isPreviewSplit,
    isPreviewExpanded,
    openPreviewPanel,
    expandPreview,
    restorePreview,
    activePreviewFilePath,
    setActivePreviewFilePath,
    previewableFiles: visiblePreviewFiles,
    canShowPreviewPanel,
    openArtifactPreview,
    closePreviewPanel,
    dismissPreviewFile,
    showEditWorkflow,
    workflowId: sessionWorkflowId,
    hasBrowserPreview,
    browserTabs,
  };
}
