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

/** 统一预览 tab：文件产物与业务网页混排在同一条标签栏（对齐 Kimi Work 预览面板模型） */
export type ChatPreviewTab =
  | { kind: 'file'; id: string; file: AttachedFileMeta }
  | { kind: 'browser'; id: string; tab: ChatBrowserPreviewTab };

export function filePreviewTabId(filePath: string): string {
  return `file:${filePath}`;
}

export function browserPreviewTabId(tabId: string): string {
  return `browser:${tabId}`;
}

export function useChatPreviewPanel(allMessages: RawMessage[], sessionKey: string) {
  const [previewMode, setPreviewMode] = useState<PreviewMode>('closed');
  const [activePreviewFilePath, setActivePreviewFilePath] = useState<string | null>(null);
  /** 活跃 tab 类型：文件产物 or 业务网页（统一 tab 模型的选中态） */
  const [activeTabKind, setActiveTabKind] = useState<'file' | 'browser'>('file');
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
  const activeBrowserTabId = useChatBrowserPreviewStore(
    (s) => s.activeTabIdBySession[sessionKey] ?? null,
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

  /** 统一 tab 序列：文件产物在前，业务网页在后（与 Kimi 右侧面板一致的混排模型） */
  const previewTabs = useMemo<ChatPreviewTab[]>(() => [
    ...visiblePreviewFiles.map((file) => ({
      kind: 'file' as const,
      id: filePreviewTabId(file.filePath),
      file,
    })),
    ...browserTabs.map((tab) => ({
      kind: 'browser' as const,
      id: browserPreviewTabId(tab.id),
      tab,
    })),
  ], [visiblePreviewFiles, browserTabs]);

  /** 当前活跃统一 tab id（browser 侧回落到 store 记录的活跃 tab / 最后一个） */
  const activePreviewTabId = useMemo(() => {
    if (activeTabKind === 'browser') {
      const fallback = activeBrowserTabId ?? browserTabs[browserTabs.length - 1]?.id ?? null;
      return fallback ? browserPreviewTabId(fallback) : null;
    }
    return activePreviewFilePath ? filePreviewTabId(activePreviewFilePath) : null;
  }, [activeTabKind, activeBrowserTabId, browserTabs, activePreviewFilePath]);

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
    setActiveTabKind('file');
    setExtraPreviewFiles([]);
    setDismissedFilePaths(new Set());
  }, [sessionKey]);

  // 新网页 tab 打开（如报价/建站工作流跳转）→ 自动展开并激活该 tab（Kimi 新 tab 语义）
  const prevBrowserTabCountRef = useRef(browserTabs.length);
  useEffect(() => {
    const grew = browserTabs.length > prevBrowserTabCountRef.current;
    prevBrowserTabCountRef.current = browserTabs.length;
    if (grew) setActiveTabKind('browser');
    if (browserTabs.length > 0 && previewMode === 'closed') {
      setPreviewMode('split');
    }
  }, [browserTabs.length, previewMode]);

  // 活跃 tab 类型与底层列表 reconciliation：
  // - browser 全关 → 回落到文件 tab / 关闭面板
  // - file 全关 → 切到 browser / 关闭面板
  // - 活跃文件被移除 → 同步到仍存在的文件
  useEffect(() => {
    if (previewMode === 'closed') return;

    if (activeTabKind === 'browser') {
      if (browserTabs.length > 0) return;
      const latest = visiblePreviewFiles[visiblePreviewFiles.length - 1];
      if (latest?.filePath) {
        setActiveTabKind('file');
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reconcile active tab kind with remaining tabs
        setActivePreviewFilePath(latest.filePath);
      } else {
        setPreviewMode('closed');
      }
      return;
    }

    if (visiblePreviewFiles.length === 0) {
      if (browserTabs.length > 0) {
        setActiveTabKind('browser');
      } else {
        setPreviewMode('closed');
        setActivePreviewFilePath(null);
      }
      return;
    }

    if (
      activePreviewFilePath !== null
      && !visiblePreviewFiles.some((file) => file.filePath === activePreviewFilePath)
    ) {
      const latest = visiblePreviewFiles[visiblePreviewFiles.length - 1];
      if (latest?.filePath) {
        // 产物列表收缩时把活跃 tab 同步到仍存在的文件。
        // eslint-disable-next-line react-hooks/set-state-in-effect -- sync active tab when file list shrinks
        setActivePreviewFilePath(latest.filePath);
      }
    }
  }, [previewMode, activeTabKind, browserTabs.length, activePreviewFilePath, visiblePreviewFiles]);

  const openPreviewPanel = useCallback(() => {
    if (hasBrowserPreview && visiblePreviewFiles.length === 0) {
      setActiveTabKind('browser');
      setPreviewMode('split');
      return;
    }
    const latestFile = visiblePreviewFiles[visiblePreviewFiles.length - 1];
    if (!latestFile?.filePath) return;
    setActiveTabKind('file');
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
    setActiveTabKind('file');
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
        // 剩余文件为空时不直接关面板——reconciliation effect 会回落到网页 tab 或关闭
        return remaining[remaining.length - 1]?.filePath ?? null;
      });

      return nextDismissed;
    });
  }, [previewFiles]);

  /** 统一 tab 选中：file:<path> / browser:<tabId> */
  const selectPreviewTab = useCallback((tabId: string) => {
    if (tabId.startsWith('browser:')) {
      const browserTabId = tabId.slice('browser:'.length);
      useChatBrowserPreviewStore.getState().setActiveTab(sessionKey, browserTabId);
      setActiveTabKind('browser');
      return;
    }
    if (tabId.startsWith('file:')) {
      setActiveTabKind('file');
      setActivePreviewFilePath(tabId.slice('file:'.length));
    }
  }, [sessionKey]);

  /** 统一 tab 关闭 */
  const dismissPreviewTab = useCallback((tabId: string) => {
    if (tabId.startsWith('browser:')) {
      useChatBrowserPreviewStore.getState().closeTab(sessionKey, tabId.slice('browser:'.length));
      return;
    }
    if (tabId.startsWith('file:')) {
      dismissPreviewFile(tabId.slice('file:'.length));
    }
  }, [sessionKey, dismissPreviewFile]);

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
    /** 统一 tab 模型（文件 + 网页混排） */
    previewTabs,
    activePreviewTabId,
    selectPreviewTab,
    dismissPreviewTab,
  };
}
