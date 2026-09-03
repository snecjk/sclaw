/**
 * Right-stage for app-dev workbench: 预览 / 代码 / 版本 + 溢出菜单（Git / 外部服务 / 社区）.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  Eye,
  FileCode2,
  FolderTree,
  GitBranch,
  History,
  Loader2,
  PlugZap,
  RotateCw,
  Save,
  Search,
  Square,
  Users,
  X,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { AppDevCommunityPanel } from '@/components/app-dev/AppDevCommunityPanel';
import { AppDevFileTree } from '@/components/app-dev/AppDevFileTree';
import { AppDevGitPanel } from '@/components/app-dev/AppDevGitPanel';
import { AppExternalServicesPanel } from '@/components/app-dev/AppExternalServicesPanel';
import { AppDevMonacoEditor, formatAppDevDiagnosticsPrompt } from '@/components/app-dev/AppDevMonacoEditor';
import { AppDevPreviewToolbar } from '@/components/app-dev/AppDevPreviewToolbar';
import {
  SclawBrowserFrame,
  type SclawBrowserFrameHandle,
} from '@/components/sclaw-browser/SclawBrowserFrame';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AppDevSetupProgress, AppDevCommandLog } from '@/components/app-dev/AppDevSetupProgress';
import { buildAppDevFileTree } from '@/lib/app-dev-file-tree';
import {
  listAppSourceFiles,
  readAppSourceFile,
  searchAppSourceFiles,
  writeAppSourceFile,
  type AppDevStatus,
  type AppRouteEntry,
  type AppSourceFileEntry,
  type AppSourceSearchHit,
  type StoAppDeployHistoryRecord,
} from '@/lib/app-dev-api';
import { resolveAppDevRouteUrl } from '@/lib/app-dev-preview-routes';
import {
  stripLegacyAppDevPreviewAuth,
} from '@/lib/app-dev-preview-url';
import {
  formatHiddenPreviewFailureForAgent,
  isHiddenPreviewFailureMessage,
} from '@/lib/app-dev-preview-console';
import { openExternalUrl } from '@/lib/preview-url';
import { cn } from '@/lib/utils';
import {
  useAppDevWorkbenchStore,
  type AppDevStageMode,
} from '@/stores/app-dev-workbench';
import '@/components/more-apps/app-plaza-shell.css';
import '@/components/sclaw-browser/sclaw-browser-overlay.css';

// 兼容旧引用：类型已迁移到 stores/app-dev-workbench。
export type { AppDevStageMode } from '@/stores/app-dev-workbench';
type CodeSidebar = 'files' | 'search';

const DEFAULT_ENTRY = 'frontend/src/App.tsx';

// 页签收敛：主区 3 个 + 溢出菜单（Git / 外部服务 / 社区）。
const PRIMARY_TABS = [
  { id: 'preview', label: '预览', icon: Eye },
  { id: 'code', label: '代码', icon: FileCode2 },
  { id: 'versions', label: '版本', icon: History },
] as const;

const OVERFLOW_TABS = [
  { id: 'more-git', label: 'Git 代码管理', icon: GitBranch },
  { id: 'more-external', label: '外部服务', icon: PlugZap },
  { id: 'more-community', label: '社区', icon: Users },
] as const;

interface OpenTab {
  path: string;
  draft: string;
  saved: string;
}

interface AppDevWorkbenchStageProps {
  workspaceId: string;
  appName: string;
  status: AppDevStatus | null;
  pendingErrors: string[];
  onFixErrors: () => void;
  onDismissErrors: () => void;
  /** Preview guest console / network errors worth fixing. */
  onPreviewRuntimeError?: (formattedLine: string) => void;
  onRetryStart: () => void;
  onCancelSetup?: () => void;
  /** Monaco diagnostics → fill chat composer (no auto-send). */
  onFillComposerFromDiagnostics?: (text: string) => void;
  /**
   * Bumped when AI / restore writes files on disk.
   * Open code tabs reload from disk (no manual「刷新代码」按钮).
   */
  sourceRevision?: number;
  /** Bumped for a process restart, including when the new server reuses a URL. */
  previewRevision?: number;
  initialMode?: AppDevStageMode;
  canDeploy?: boolean;
  cloudPush?: boolean;
  recordsRevision?: number;
  deployRunning?: boolean;
  deployHistory?: StoAppDeployHistoryRecord[];
  onOpenDeploy?: () => void;
}

function fileName(path: string): string {
  return path.split('/').pop() || path;
}

export const AppDevWorkbenchStage = memo(function AppDevWorkbenchStage({
  workspaceId,
  appName,
  status,
  pendingErrors,
  onFixErrors,
  onDismissErrors,
  onPreviewRuntimeError,
  onRetryStart,
  onCancelSetup,
  onFillComposerFromDiagnostics,
  sourceRevision = 0,
  previewRevision = 0,
  initialMode,
  canDeploy = false,
  cloudPush = false,
  recordsRevision = 0,
  deployRunning = false,
  deployHistory = [],
  onOpenDeploy,
}: AppDevWorkbenchStageProps) {
  // mode 提升到全局 store：对话侧可通过 setMode 驱动工作台切换（T04/T09 依赖）。
  const mode = useAppDevWorkbenchStore((s) => s.mode);
  const setMode = useAppDevWorkbenchStore((s) => s.setMode);
  // 预览设备（T03）：desktop / mobile，设备框纯 CSS 过渡，不 remount webview。
  const device = useAppDevWorkbenchStore((s) => s.device);
  const [sidebar, setSidebar] = useState<CodeSidebar>('files');
  const [files, setFiles] = useState<AppSourceFileEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [activePath, setActivePath] = useState(DEFAULT_ENTRY);
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchHits, setSearchHits] = useState<AppSourceSearchHit[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const phase = status?.phase ?? 'created';
  const isRunning = phase === 'ready' && Boolean(status?.previewUrl);
  const activeTab = tabs.find((t) => t.path === activePath) ?? null;
  const dirty = Boolean(activeTab && activeTab.draft !== activeTab.saved);
  const tree = useMemo(() => buildAppDevFileTree(files.map((f) => f.path)), [files]);
  const openPathsRef = useRef<Set<string>>(new Set());
  const tabsRef = useRef(tabs);
  const previewFrameRef = useRef<SclawBrowserFrameHandle>(null);
  /** 预览列根容器：全屏（requestFullscreen / CSS 降级）的目标元素。 */
  const previewRootRef = useRef<HTMLDivElement>(null);
  const sourceRevisionSeenRef = useRef(sourceRevision);
  const handleSaveRef = useRef<() => void | Promise<void>>(() => undefined);
  const refreshPreviewRef = useRef<() => void>(() => undefined);
  const refreshOpenCodeRef = useRef<(opts?: { force?: boolean }) => Promise<void>>(
    async () => undefined,
  );
  const [previewCanGoBack, setPreviewCanGoBack] = useState(false);
  const [previewAddress, setPreviewAddress] = useState('');
  /**
   * URL the frame is mounted with. Only explicit refresh / address commits may
   * change it — tracking in-page navigation here would remount on every route.
   */
  const [previewMountUrl, setPreviewMountUrl] = useState('');
  const [previewReloadNonce, setPreviewReloadNonce] = useState(0);

  useEffect(() => {
    const next = status?.previewUrl ?? '';
    const clean = stripLegacyAppDevPreviewAuth(next) || next;
    setPreviewAddress(clean);
    setPreviewMountUrl(clean);
    setPreviewCanGoBack(false);
    setPreviewReloadNonce(0);
  }, [status?.previewUrl]);

  useEffect(() => {
    openPathsRef.current = new Set(tabs.map((t) => t.path));
    tabsRef.current = tabs;
  }, [tabs]);

  // 显式传入 initialMode 时（如独立 IDE 窗口默认「代码」）以其为准；
  // 未传入时沿用 store 中的持久化 mode。
  useEffect(() => {
    if (initialMode) setMode(initialMode);
  }, [initialMode, workspaceId, setMode]);

  const loadFileList = async () => {
    setFilesLoading(true);
    try {
      const next = await listAppSourceFiles(workspaceId);
      setFiles(next);
      setActivePath((current) => {
        if (next.some((f) => f.path === current)) return current;
        return next.find((f) => f.path === DEFAULT_ENTRY)?.path ?? next[0]?.path ?? current;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '无法加载文件列表');
    } finally {
      setFilesLoading(false);
    }
  };

  useEffect(() => {
    if (mode !== 'code') return;
    void loadFileList();
  }, [mode, workspaceId]);

  useEffect(() => {
    if (mode !== 'code' || !activePath) return;
    if (openPathsRef.current.has(activePath)) {
      setFileError(null);
      return;
    }

    let cancelled = false;
    setFileLoading(true);
    setFileError(null);
    void readAppSourceFile(workspaceId, activePath)
      .then((file) => {
        if (cancelled) return;
        setTabs((prev) => {
          if (prev.some((t) => t.path === file.path)) return prev;
          return [...prev, { path: file.path, draft: file.content, saved: file.content }];
        });
        setActivePath(file.path);
      })
      .catch((err) => {
        if (cancelled) return;
        setFileError(err instanceof Error ? err.message : '无法打开文件');
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, activePath, mode]);

  const handleSave = async () => {
    const tab = tabs.find((t) => t.path === activePath);
    if (!tab || tab.draft === tab.saved || saving) return;
    setSaving(true);
    try {
      await writeAppSourceFile(workspaceId, tab.path, tab.draft);
      setTabs((prev) => prev.map((t) => (
        t.path === tab.path ? { ...t, saved: t.draft } : t
      )));
      toast.success('已保存');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const refreshPreview = () => {
    const frame = previewFrameRef.current;
    if (frame) {
      // Reuse the guest Chromium process. Remounting the <webview> (key/nonce)
      // briefly doubles renderer memory and is the main source of workbench jank.
      frame.reload();
      return;
    }
    const current =
      previewAddress.trim()
      || status?.previewUrl?.trim()
      || '';
    if (!current) return;
    const clean = stripLegacyAppDevPreviewAuth(current) || current;
    setPreviewMountUrl(clean);
    setPreviewAddress(clean);
    setPreviewCanGoBack(false);
    setPreviewReloadNonce((value) => value + 1);
  };

  const commitPreviewAddress = () => {
    const next = previewAddress.trim();
    if (!next) {
      setPreviewAddress(
        stripLegacyAppDevPreviewAuth(previewMountUrl || status?.previewUrl || '')
          || previewMountUrl
          || status?.previewUrl
          || '',
      );
      return;
    }
    const clean = stripLegacyAppDevPreviewAuth(next) || next;
    setPreviewAddress(clean);
    setPreviewMountUrl(clean);
    previewFrameRef.current?.loadURL(clean);
  };

  const openPreviewInSystemBrowser = () => {
    const current =
      previewFrameRef.current?.getURL()?.trim()
      || previewAddress.trim()
      || status?.previewUrl?.trim()
      || '';
    if (!current) {
      toast.message('预览还没准备好，稍后再试');
      return;
    }
    const clean = stripLegacyAppDevPreviewAuth(current) || current;
    openExternalUrl(clean);
  };

  /** 当前预览真实地址（frame 优先），去敏后的展示形式。 */
  const resolveCurrentPreviewUrl = () => {
    const current =
      previewFrameRef.current?.getURL()
      || previewMountUrl
      || status?.previewUrl
      || '';
    return stripLegacyAppDevPreviewAuth(current) || current;
  };

  const handleAddressBlur = () => {
    const display = resolveCurrentPreviewUrl();
    if (previewAddress.trim() && previewAddress.trim() !== display) {
      commitPreviewAddress();
    } else {
      setPreviewAddress(display);
    }
  };

  const handleAddressEscape = (input: HTMLInputElement) => {
    setPreviewAddress(resolveCurrentPreviewUrl());
    input.blur();
  };

  /** 路由下拉跳转（T03）：只改地址，不触碰 frame 的 key/nonce。 */
  const navigatePreviewRoute = (route: AppRouteEntry) => {
    const base =
      previewFrameRef.current?.getURL()
      || previewMountUrl
      || status?.previewUrl
      || '';
    const next = resolveAppDevRouteUrl(base, route.path);
    if (!next) {
      toast.message('无法跳转到该页面');
      return;
    }
    previewFrameRef.current?.loadURL(next);
    setPreviewAddress(stripLegacyAppDevPreviewAuth(next) || next);
  };

  const refreshOpenCodeFromDisk = async (opts?: { force?: boolean }) => {
    const openTabs = tabsRef.current;
    await loadFileList();
    if (openTabs.length === 0) return;

    setFileLoading(true);
    try {
      const results = await Promise.all(
        openTabs.map(async (tab) => {
          if (!opts?.force && tab.draft !== tab.saved) {
            return { path: tab.path, skipped: true as const };
          }
          const file = await readAppSourceFile(workspaceId, tab.path);
          return { path: tab.path, content: file.content, skipped: false as const };
        }),
      );
      setTabs((prev) => prev.map((tab) => {
        const hit = results.find((r) => r.path === tab.path);
        if (!hit || hit.skipped) return tab;
        return { ...tab, draft: hit.content, saved: hit.content };
      }));
      const skipped = results.filter((r) => r.skipped).length;
      if (skipped > 0 && !opts?.force) {
        toast.message(`有 ${skipped} 个未保存文件未刷新`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '刷新代码失败');
    } finally {
      setFileLoading(false);
    }
  };

  useEffect(() => {
    if (sourceRevision <= 0) return;
    if (sourceRevisionSeenRef.current === sourceRevision) return;
    sourceRevisionSeenRef.current = sourceRevision;
    void refreshOpenCodeFromDisk({ force: true });
    refreshPreview();
  }, [sourceRevision, workspaceId]);

  useEffect(() => {
    sourceRevisionSeenRef.current = -1;
  }, [workspaceId]);

  handleSaveRef.current = handleSave;
  refreshPreviewRef.current = refreshPreview;
  refreshOpenCodeRef.current = refreshOpenCodeFromDisk;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const currentMode = useAppDevWorkbenchStore.getState().mode;
      const isSave = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's';
      if (isSave && currentMode === 'code') {
        event.preventDefault();
        event.stopPropagation();
        void handleSaveRef.current();
        return;
      }

      const isRefresh =
        event.key === 'F5'
        || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'r' && !event.shiftKey);
      if (!isRefresh) return;

      // Capture: prevent Electron / Chromium from reloading the whole workbench shell.
      event.preventDefault();
      event.stopPropagation();

      if (currentMode === 'preview') {
        refreshPreviewRef.current();
        return;
      }
      if (currentMode === 'code') {
        void refreshOpenCodeRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const openFile = (path: string) => {
    setActivePath(path);
    setMode('code');
    setSidebar('files');
  };

  const closeTab = (path: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== path);
      if (path === activePath) {
        const fallback = next[next.length - 1]?.path
          ?? files.find((f) => f.path === DEFAULT_ENTRY)?.path
          ?? next[0]?.path
          ?? DEFAULT_ENTRY;
        setActivePath(fallback);
      }
      return next;
    });
  };

  const updateDraft = (next: string) => {
    setTabs((prev) => prev.map((t) => (t.path === activePath ? { ...t, draft: next } : t)));
  };

  const runSearch = async () => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchHits([]);
      return;
    }
    setSearchLoading(true);
    try {
      const hits = await searchAppSourceFiles(workspaceId, q);
      setSearchHits(hits);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '搜索失败');
    } finally {
      setSearchLoading(false);
    }
  };

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-muted/30">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1.5">
        {PRIMARY_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = mode === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
                active
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
              )}
              aria-pressed={active}
              onClick={() => setMode(tab.id)}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {tab.label}
            </button>
          );
        })}

        {(() => {
          const activeOverflow = OVERFLOW_TABS.find((tab) => tab.id === mode) ?? null;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-medium transition-colors',
                    activeOverflow
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
                  )}
                  aria-pressed={Boolean(activeOverflow)}
                >
                  {activeOverflow ? activeOverflow.label : '更多'}
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[9rem]">
                {OVERFLOW_TABS.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <DropdownMenuItem
                      key={tab.id}
                      className="gap-1.5 text-xs"
                      onSelect={() => setMode(tab.id)}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                      {tab.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })()}

        <div className="ml-auto flex items-center gap-2">
          {mode === 'code' ? (
            <>
              <span className="max-w-[240px] truncate text-[11px] text-muted-foreground" title={activePath}>
                {activePath}
                {dirty ? ' · 未保存' : ''}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs"
                disabled={!dirty || saving || fileLoading}
                onClick={() => void handleSave()}
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Save className="h-3.5 w-3.5" aria-hidden />}
                保存
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {pendingErrors.length > 0 ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-[var(--sto-functional-warning)]/10 px-4 py-2">
          <p className="flex min-w-0 items-center gap-2 text-sm text-foreground">
            <AlertCircle className="h-4 w-4 shrink-0 text-[var(--sto-functional-warning)]" aria-hidden />
            <span className="truncate">
              页面上看起来正常，但后台有请求失败。要交给 AI 处理吗？
              {pendingErrors.length > 1 ? `（${pendingErrors.length} 条）` : ''}
            </span>
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" size="sm" className="gap-1 text-xs" onClick={onFixErrors}>
              <Wand2 className="h-3.5 w-3.5" aria-hidden />
              交给 AI
            </Button>
            <button type="button" className="text-xs text-muted-foreground underline" onClick={onDismissErrors}>
              忽略
            </button>
          </div>
        </div>
      ) : null}

      {mode === 'preview' ? (
        isRunning && status?.previewUrl ? (
          <div className="flex min-h-0 flex-1 flex-col" ref={previewRootRef}>
            <AppDevPreviewToolbar
              workspaceId={workspaceId}
              canGoBack={previewCanGoBack}
              address={previewAddress}
              previewRevision={previewRevision}
              fullscreenTargetRef={previewRootRef}
              onBack={() => previewFrameRef.current?.goBack()}
              onReload={refreshPreview}
              onAddressChange={setPreviewAddress}
              onAddressSubmit={commitPreviewAddress}
              onAddressBlur={handleAddressBlur}
              onAddressEscape={handleAddressEscape}
              onOpenExternal={openPreviewInSystemBrowser}
              onNavigateRoute={navigatePreviewRoute}
            />
            {/*
              设备切换只改变外层视口宽度与设备框样式（200ms CSS 过渡），
              SclawBrowserFrame 的 key 不含 device —— webview 不 remount，
              页面状态（表单输入、HMR 会话）保留。
            */}
            <div className="app-dev-preview-viewport" data-device={device}>
              <div className="app-dev-preview-device">
                <SclawBrowserFrame
                  key={`${previewMountUrl || stripLegacyAppDevPreviewAuth(status.previewUrl)}:${previewRevision}:${previewReloadNonce}`}
                  ref={previewFrameRef}
                  url={previewMountUrl || stripLegacyAppDevPreviewAuth(status.previewUrl)}
                  title={appName}
                  embedRuntimeId={null}
                  captureGuestNetworkFailures
                  onNavStateChange={({ canGoBack }) => setPreviewCanGoBack(canGoBack)}
                  onPageUrl={(pageUrl) =>
                    setPreviewAddress(stripLegacyAppDevPreviewAuth(pageUrl) || pageUrl)
                  }
                  onConsoleMessage={({ message }) => {
                    if (!onPreviewRuntimeError) return;
                    if (!isHiddenPreviewFailureMessage(message)) return;
                    const pageUrl =
                      previewFrameRef.current?.getURL()
                      || previewAddress
                      || status.previewUrl
                      || '';
                    const cleanPageUrl = stripLegacyAppDevPreviewAuth(pageUrl) || pageUrl;
                    onPreviewRuntimeError(formatHiddenPreviewFailureForAgent(message, cleanPageUrl));
                  }}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8">
            {phase === 'error' ? (
              <div className="w-full max-w-[480px] text-center">
                  <AlertCircle className="mx-auto mb-4 h-10 w-10 text-[var(--sto-functional-error)]" aria-hidden />
                  <p className="mb-2 text-sm font-medium text-foreground">
                    {/snpm install/i.test(status?.error ?? '') ? '依赖安装遇到了问题' : '应用启动遇到了问题'}
                  </p>
                  <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                    可以重试一次；如果仍然失败，把下方日志发给 AI「帮我看看」。
                  </p>
                  {status?.error ? (
                    <AppDevCommandLog log={status.error} className="mb-3" />
                  ) : (
                    <AppDevCommandLog log={status?.log} className="mb-3" />
                  )}
                  <Button type="button" size="sm" className="gap-1" onClick={onRetryStart}>
                    <RotateCw className="h-3.5 w-3.5" aria-hidden />
                    重试
                  </Button>
              </div>
            ) : phase === 'stopped' ? (
              <div className="w-full max-w-sm text-center">
                  <Square className="mx-auto mb-4 h-9 w-9 text-muted-foreground" aria-hidden />
                  <p className="mb-2 text-sm font-medium text-foreground">预览已停止</p>
                  <p className="mb-6 text-xs leading-relaxed text-muted-foreground">
                    可以从顶部状态菜单重新启动，也可以点击下方按钮启动。
                  </p>
                  <Button type="button" size="sm" className="gap-1" onClick={onRetryStart}>
                    <RotateCw className="h-3.5 w-3.5" aria-hidden />
                    启动预览
                  </Button>
              </div>
            ) : (
              <AppDevSetupProgress
                phase={phase || 'created'}
                progress={status?.progress ?? 0}
                detail={status?.detail}
                log={status?.log}
                onCancel={onCancelSetup}
              />
            )}
          </div>
        )
      ) : null}

      {mode === 'versions' ? (
        // T04 将在此挂载行级 diff 容器（T10 填版本时间线）。
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <History className="h-9 w-9 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium text-foreground">版本对比</p>
          <p className="max-w-[280px] text-xs leading-relaxed text-muted-foreground">
            每轮对话的修改内容对比（行级 diff）将在后续版本展示在这里。
          </p>
        </div>
      ) : null}

      {mode === 'more-git' ? (
        <AppDevGitPanel
          workspaceId={workspaceId}
          canDeploy={canDeploy}
          cloudPush={cloudPush}
          recordsRevision={recordsRevision}
          deployRunning={deployRunning}
          deployHistory={deployHistory}
          onOpenDeploy={onOpenDeploy}
        />
      ) : null}

      {mode === 'more-external' ? <AppExternalServicesPanel workspaceId={workspaceId} /> : null}

      {mode === 'more-community' ? <AppDevCommunityPanel workspaceId={workspaceId} /> : null}

      {mode === 'code' ? (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-border bg-muted/40 py-2">
            <button
              type="button"
              title="文件"
              aria-pressed={sidebar === 'files'}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-md',
                sidebar === 'files'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
              )}
              onClick={() => setSidebar('files')}
            >
              <FolderTree className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              title="全局搜索"
              aria-pressed={sidebar === 'search'}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-md',
                sidebar === 'search'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
              )}
              onClick={() => setSidebar('search')}
            >
              <Search className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <aside className="flex h-full min-h-0 w-[240px] shrink-0 flex-col overflow-hidden border-r border-border bg-background/40">
            {sidebar === 'files' ? (
              <>
                <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">文件</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-[11px]"
                    disabled={filesLoading}
                    onClick={() => void loadFileList()}
                  >
                    {filesLoading ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : '刷新'}
                  </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-1">
                  {filesLoading && files.length === 0 ? (
                    <p className="px-3 py-6 text-center text-xs text-muted-foreground">加载中…</p>
                  ) : (
                    <AppDevFileTree nodes={tree} activePath={activePath} onOpenFile={openFile} />
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="flex h-9 shrink-0 items-center border-b border-border px-3">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">搜索</span>
                </div>
                <div className="space-y-2 border-b border-border px-2 py-2">
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void runSearch();
                    }}
                    placeholder="在项目中搜索"
                    className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 w-full text-xs"
                    disabled={searchLoading || !searchQuery.trim()}
                    onClick={() => void runSearch()}
                  >
                    {searchLoading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                    搜索
                  </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto px-1 py-1">
                  {searchHits.length === 0 ? (
                    <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                      {searchLoading ? '搜索中…' : '输入关键词后回车搜索'}
                    </p>
                  ) : (
                    <ul className="space-y-1 py-1">
                      {searchHits.map((hit) => (
                        <li key={`${hit.path}:${hit.line}:${hit.column}`}>
                          <button
                            type="button"
                            className="w-full rounded-md px-2 py-1.5 text-left hover:bg-background/80"
                            onClick={() => openFile(hit.path)}
                          >
                            <div className="truncate text-[11px] font-medium text-foreground">
                              {hit.path}
                              <span className="text-muted-foreground">:{hit.line}</span>
                            </div>
                            <div className="truncate text-[11px] text-muted-foreground">{hit.preview}</div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {tabs.length > 0 ? (
              <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border bg-muted/20 px-1">
                {tabs.map((tab) => {
                  const active = tab.path === activePath;
                  const tabDirty = tab.draft !== tab.saved;
                  return (
                    <div
                      key={tab.path}
                      className={cn(
                        'group flex h-8 max-w-[180px] items-center gap-1 rounded-t-md px-2 text-xs',
                        active
                          ? 'bg-background text-foreground'
                          : 'text-muted-foreground hover:bg-background/60',
                      )}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate text-left"
                        title={tab.path}
                        onClick={() => setActivePath(tab.path)}
                      >
                        {fileName(tab.path)}
                        {tabDirty ? ' •' : ''}
                      </button>
                      <button
                        type="button"
                        className="rounded p-0.5 opacity-60 hover:bg-muted hover:opacity-100"
                        aria-label={`关闭 ${tab.path}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          closeTab(tab.path);
                        }}
                      >
                        <X className="h-3 w-3" aria-hidden />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div className="flex min-h-0 flex-1 flex-col">
              {fileLoading && !activeTab ? (
                <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  正在打开文件…
                </div>
              ) : fileError && !activeTab ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                  <p className="text-sm text-muted-foreground">{fileError}</p>
                  <Button type="button" size="sm" variant="outline" onClick={() => setSidebar('files')}>
                    从文件树选择
                  </Button>
                </div>
              ) : activeTab ? (
                <AppDevMonacoEditor
                  filePath={activeTab.path}
                  value={activeTab.draft}
                  onChange={updateDraft}
                  className="flex-1"
                  onFixWithAgent={
                    onFillComposerFromDiagnostics
                      ? (diagnostics, path) => {
                          onFillComposerFromDiagnostics(
                            formatAppDevDiagnosticsPrompt(path, diagnostics),
                          );
                        }
                      : undefined
                  }
                />
              ) : (
                <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                  从左侧文件树打开一个文件
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
});
