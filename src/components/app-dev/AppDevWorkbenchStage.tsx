/**
 * Right-stage for app-dev workbench: 预览 / 代码 / Git / 云服务 / 社区.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Cloud,
  ExternalLink,
  Eye,
  FileCode2,
  FolderTree,
  GitBranch,
  Loader2,
  RotateCw,
  Save,
  Search,
  Square,
  Users,
  X,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { AppDevCloudPanel } from '@/components/app-dev/AppDevCloudPanel';
import { AppDevCommunityPanel } from '@/components/app-dev/AppDevCommunityPanel';
import { AppDevFileTree } from '@/components/app-dev/AppDevFileTree';
import { AppDevGitPanel } from '@/components/app-dev/AppDevGitPanel';
import { AppDevMonacoEditor, formatAppDevDiagnosticsPrompt } from '@/components/app-dev/AppDevMonacoEditor';
import {
  SclawBrowserFrame,
  type SclawBrowserFrameHandle,
} from '@/components/sclaw-browser/SclawBrowserFrame';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { buildAppDevFileTree } from '@/lib/app-dev-file-tree';
import {
  listAppSourceFiles,
  readAppSourceFile,
  searchAppSourceFiles,
  writeAppSourceFile,
  type AppDevStatus,
  type AppSourceFileEntry,
  type AppSourceSearchHit,
} from '@/lib/app-dev-api';
import {
  stripLegacyAppDevPreviewAuth,
} from '@/lib/app-dev-preview-url';
import {
  formatHiddenPreviewFailureForAgent,
  isHiddenPreviewFailureMessage,
} from '@/lib/app-dev-preview-console';
import { openExternalUrl } from '@/lib/preview-url';
import { cn } from '@/lib/utils';
import '@/components/more-apps/app-plaza-shell.css';
import '@/components/sclaw-browser/sclaw-browser-overlay.css';

export type AppDevStageMode = 'preview' | 'code' | 'git' | 'cloud' | 'community';
type CodeSidebar = 'files' | 'search';

const DEFAULT_ENTRY = 'frontend/src/App.tsx';

const PHASE_LABELS: Record<string, string> = {
  created: '正在准备运行环境…',
  'preparing-env': '正在准备运行环境…',
  installing: '正在安装应用组件…',
  starting: '正在启动应用…',
  ready: '运行中',
  stopped: '已停止',
  error: '出了点问题',
};

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
  /** Monaco diagnostics → fill chat composer (no auto-send). */
  onFillComposerFromDiagnostics?: (text: string) => void;
  /**
   * Bumped when AI / restore writes files on disk.
   * Open code tabs reload from disk (no manual「刷新代码」按钮).
   */
  sourceRevision?: number;
  /** Bumped for a process restart, including when the new server reuses a URL. */
  previewRevision?: number;
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
  onFillComposerFromDiagnostics,
  sourceRevision = 0,
  previewRevision = 0,
}: AppDevWorkbenchStageProps) {
  const [mode, setMode] = useState<AppDevStageMode>('preview');
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
  const modeRef = useRef(mode);
  const previewFrameRef = useRef<SclawBrowserFrameHandle>(null);
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

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

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
      const isSave = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's';
      if (isSave && modeRef.current === 'code') {
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

      const currentMode = modeRef.current;
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
    <section className="relative flex min-w-0 flex-1 flex-col bg-muted/30">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1.5">
        {(
          [
            { id: 'preview', label: '预览', icon: Eye },
            { id: 'code', label: '代码', icon: FileCode2 },
            { id: 'git', label: 'Git 代码管理', icon: GitBranch },
            { id: 'cloud', label: '云服务', icon: Cloud },
            { id: 'community', label: '社区', icon: Users },
          ] as const
        ).map((tab) => {
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
          <div className="flex min-h-0 flex-1 flex-col">
            <header className="app-plaza-browser-toolbar">
              <div className="app-plaza-browser-toolbar__nav">
                <button
                  type="button"
                  className="app-plaza-browser-toolbar__nav-btn"
                  disabled={!previewCanGoBack}
                  onClick={() => previewFrameRef.current?.goBack()}
                  title="返回上一页"
                  aria-label="返回上一页"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  className="app-plaza-browser-toolbar__nav-btn"
                  onClick={refreshPreview}
                  title="刷新"
                  aria-label="刷新"
                >
                  <RotateCw className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <form
                className="app-plaza-browser-address"
                onSubmit={(event) => {
                  event.preventDefault();
                  commitPreviewAddress();
                }}
              >
                <input
                  className="app-plaza-browser-toolbar__url"
                  value={previewAddress}
                  onChange={(event) => setPreviewAddress(event.target.value)}
                  onBlur={() => {
                    const current =
                      previewFrameRef.current?.getURL()
                      || previewMountUrl
                      || status.previewUrl
                      || '';
                    const display = stripLegacyAppDevPreviewAuth(current) || current;
                    if (previewAddress.trim() && previewAddress.trim() !== display) {
                      commitPreviewAddress();
                    } else {
                      setPreviewAddress(display);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      const current =
                        previewFrameRef.current?.getURL()
                        || previewMountUrl
                        || status.previewUrl
                        || '';
                      setPreviewAddress(stripLegacyAppDevPreviewAuth(current) || current);
                      (event.target as HTMLInputElement).blur();
                    }
                  }}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  aria-label="预览地址"
                />
              </form>
              <button
                type="button"
                className="app-plaza-browser-toolbar__btn"
                onClick={openPreviewInSystemBrowser}
              >
                在系统浏览器打开
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </button>
            </header>
            <div className="relative min-h-0 flex-1">
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
        ) : (
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="w-full max-w-sm text-center">
              {phase === 'error' ? (
                <>
                  <AlertCircle className="mx-auto mb-4 h-10 w-10 text-[var(--sto-functional-error)]" aria-hidden />
                  <p className="mb-2 text-sm font-medium text-foreground">应用启动遇到了问题</p>
                  <p className="mb-6 text-xs leading-relaxed text-muted-foreground">
                    可以重试一次；如果仍然失败，可在左侧告诉 AI「应用启动失败了，帮我看看」。
                  </p>
                  <Button type="button" size="sm" className="gap-1" onClick={onRetryStart}>
                    <RotateCw className="h-3.5 w-3.5" aria-hidden />
                    重试
                  </Button>
                </>
              ) : phase === 'stopped' ? (
                <>
                  <Square className="mx-auto mb-4 h-9 w-9 text-muted-foreground" aria-hidden />
                  <p className="mb-2 text-sm font-medium text-foreground">预览已停止</p>
                  <p className="mb-6 text-xs leading-relaxed text-muted-foreground">
                    可以从顶部状态菜单重新启动，也可以点击下方按钮启动。
                  </p>
                  <Button type="button" size="sm" className="gap-1" onClick={onRetryStart}>
                    <RotateCw className="h-3.5 w-3.5" aria-hidden />
                    启动预览
                  </Button>
                </>
              ) : (
                <>
                  <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
                  <p className="mb-4 text-sm font-medium text-foreground">{PHASE_LABELS[phase]}</p>
                  <Progress value={status?.progress ?? 0} className="mb-3" />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    首次创建需要准备运行环境，通常在一两分钟内完成。你可以先在左侧描述想做的功能。
                  </p>
                </>
              )}
            </div>
          </div>
        )
      ) : null}

      {mode === 'git' ? <AppDevGitPanel workspaceId={workspaceId} /> : null}

      {mode === 'cloud' ? (
        <AppDevCloudPanel workspaceId={workspaceId} appName={appName} />
      ) : null}

      {mode === 'community' ? <AppDevCommunityPanel workspaceId={workspaceId} /> : null}

      {mode === 'code' ? (
        <div className="flex min-h-0 flex-1">
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

          <aside className="flex w-[240px] shrink-0 flex-col border-r border-border bg-background/40">
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
                <div className="min-h-0 flex-1 overflow-auto px-1 py-1">
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

          <div className="flex min-w-0 flex-1 flex-col">
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
