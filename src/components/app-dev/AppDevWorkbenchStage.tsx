/**
 * Right-stage for app-dev workbench: 预览 / 代码 / Git / 云服务 / 社区.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Cloud,
  Eye,
  FileCode2,
  FolderTree,
  GitBranch,
  Loader2,
  RotateCw,
  Save,
  Search,
  Users,
  X,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { AppDevCloudPanel } from '@/components/app-dev/AppDevCloudPanel';
import { AppDevCommunityPanel } from '@/components/app-dev/AppDevCommunityPanel';
import { AppDevFileTree } from '@/components/app-dev/AppDevFileTree';
import { AppDevGitPanel } from '@/components/app-dev/AppDevGitPanel';
import { AppDevMonacoEditor } from '@/components/app-dev/AppDevMonacoEditor';
import { SclawBrowserFrame } from '@/components/sclaw-browser/SclawBrowserFrame';
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
import { cn } from '@/lib/utils';

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
  onRetryStart: () => void;
}

function fileName(path: string): string {
  return path.split('/').pop() || path;
}

export function AppDevWorkbenchStage({
  workspaceId,
  appName,
  status,
  pendingErrors,
  onFixErrors,
  onDismissErrors,
  onRetryStart,
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

  useEffect(() => {
    openPathsRef.current = new Set(tabs.map((t) => t.path));
  }, [tabs]);

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

  useEffect(() => {
    if (mode !== 'code') return;
    const onKeyDown = (event: KeyboardEvent) => {
      const isSave = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's';
      if (!isSave) return;
      event.preventDefault();
      void handleSave();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

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
            <span className="truncate">页面运行出现了一点问题</span>
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" size="sm" className="gap-1 text-xs" onClick={onFixErrors}>
              <Wand2 className="h-3.5 w-3.5" aria-hidden />
              让 AI 修复
            </Button>
            <button type="button" className="text-xs text-muted-foreground underline" onClick={onDismissErrors}>
              忽略
            </button>
          </div>
        </div>
      ) : null}

      {mode === 'preview' ? (
        isRunning && status?.previewUrl ? (
          <SclawBrowserFrame url={status.previewUrl} title={appName} embedRuntimeId={null} />
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
}
