/**
 * ChatPreviewPanel — 三栏预览区右侧面板
 *
 * 双行头部：上行产物 tab + 收起；下行标题/元信息 + 操作按钮。
 * 使用位置：Chat / HomeMainConversation / TaskSubitemChatSurface
 */
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X,
  RefreshCw,
  Download,
  FileText,
  FileCode,
  File,
  Menu,
  Presentation,
  Table2,
  MonitorPlay,
  Eye,
  PanelRightClose,
  Share2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { isHttpUrl, inferMimeTypeFromUrl } from '@/lib/preview-url';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { FilePreviewViewer } from '@/components/file-preview/FilePreviewViewer';
import { WorkflowPreviewPanel } from '@/components/workflow/WorkflowPreviewPanel';
import {
  stoPreviewActionButtonClass,
  stoPreviewActionRowClass,
  stoPreviewArtifactTabClass,
  stoPreviewTabRowClass,
} from '@/lib/surfaces';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AttachedFileMeta } from '@/stores/chat';
import type { WorkflowDetailResponse } from '@/types/workflow';

export interface ChatPreviewPanelProps {
  /** 当前可见的产物列表（已过滤 dismissed） */
  files: AttachedFileMeta[];
  activeFilePath: string | null;
  onSelectFile: (filePath: string) => void;
  /** 收起整个预览区 */
  onClose: () => void;
  /** 关闭单个产物 tab（本地隐藏） */
  onDismissFile?: (filePath: string) => void;
  className?: string;
  showWorkflowTab?: boolean;
  workflowId?: string | null;
  workflowDetail?: WorkflowDetailResponse | null;
  workflowLoading?: boolean;
  workflowError?: string | null;
  activeTab?: PreviewTab;
  onActiveTabChange?: (tab: PreviewTab) => void;
}

type PreviewTab = 'product' | 'workflow';

function fileIcon(mimeType: string) {
  if (mimeType === 'text/html' || mimeType === 'text/markdown') return FileCode;
  if (mimeType === 'application/pdf') return FileText;
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    mimeType === 'application/vnd.ms-powerpoint'
  ) return Presentation;
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel' ||
    mimeType === 'text/csv' ||
    mimeType === 'text/tab-separated-values'
  ) return Table2;
  return File;
}

function truncateTabLabel(name: string, maxLen = 8): string {
  if (name.length <= maxLen) return name;
  return `${name.slice(0, maxLen)}...`;
}

export function ChatPreviewPanel({
  files,
  activeFilePath,
  onSelectFile,
  onClose,
  onDismissFile,
  className,
  showWorkflowTab = false,
  workflowId = null,
  workflowDetail = null,
  workflowLoading = false,
  workflowError = null,
  activeTab: controlledTab,
  onActiveTabChange,
}: ChatPreviewPanelProps) {
  const { t } = useTranslation('chat');
  const navigate = useNavigate();
  const [internalTab, setInternalTab] = useState<PreviewTab>('product');
  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = onActiveTabChange ?? setInternalTab;
  const [refreshKey, setRefreshKey] = useState(0);

  const isWin32 = window.electron?.platform === 'win32';
  const chromeSafeClass = cn(isWin32 && 'pr-[120px]');

  const activeFile = useMemo(() => {
    if (activeTab === 'workflow') return null;
    if (!activeFilePath) return null;
    const found = files.find((f) => f.filePath === activeFilePath);
    if (found) return found;
    if (isHttpUrl(activeFilePath)) {
      return {
        filePath: activeFilePath,
        fileName: activeFilePath.replace(/^https?:\/\//, ''),
        mimeType: inferMimeTypeFromUrl(activeFilePath),
        fileSize: 0,
        preview: null,
      } satisfies AttachedFileMeta;
    }
    return null;
  }, [activeTab, files, activeFilePath]);

  const headerTitle = activeTab === 'workflow'
    ? (workflowDetail?.workflowName ?? t('preview.workflowTab'))
    : (activeFile?.fileName ?? t('preview.workflowTab'));

  const handleOpenExternal = useCallback(() => {
    if (!activeFile?.filePath) return;
    if (activeFile.filePath.startsWith('http://') || activeFile.filePath.startsWith('https://')) {
      window.electron.openExternal(activeFile.filePath);
    } else {
      invokeIpc('shell:openPath', activeFile.filePath);
    }
  }, [activeFile]);

  const handleFullscreen = useCallback(() => {
    const el = document.querySelector('[data-preview-viewer]') as HTMLElement | null;
    if (el) {
      if (!document.fullscreenElement) {
        el.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    }
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleDownload = useCallback(async () => {
    if (!activeFile?.filePath) return;
    if (activeFile.filePath.startsWith('http://') || activeFile.filePath.startsWith('https://')) {
      window.electron.openExternal(activeFile.filePath);
      return;
    }
    try {
      const res = await hostApiFetch<{ content: string; encoding: string }>('/api/files/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: activeFile.filePath, encoding: 'base64' }),
      });
      const blob = new Blob([Uint8Array.from(atob(res.content), (c) => c.charCodeAt(0))], {
        type: activeFile.mimeType,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = activeFile.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      handleOpenExternal();
    }
  }, [activeFile, handleOpenExternal]);

  const handleEditWorkflow = useCallback(() => {
    if (workflowId) navigate('/workflow');
  }, [navigate, workflowId]);

  const handleSelectProductTab = useCallback((filePath: string) => {
    setActiveTab('product');
    onSelectFile(filePath);
  }, [onSelectFile, setActiveTab]);

  const handleSelectWorkflowTab = useCallback(() => {
    setActiveTab('workflow');
  }, [setActiveTab]);

  if (files.length === 0 && !showWorkflowTab) return null;

  return (
    <div className={cn('flex min-h-0 min-w-0 flex-col', className)}>
      {/* 双行头部：预留窗口 chrome 高度，避免被交通灯/窗口控件遮挡 */}
      <div className={cn('shrink-0 pt-[var(--sto-chrome-h)]', chromeSafeClass)}>
        {/* 上行：产物 tab + 收起 */}
        <div className={stoPreviewTabRowClass}>
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    stoPreviewActionButtonClass,
                    'shrink-0',
                  )}
                  aria-label={t('preview.overflowMenu')}
                >
                  <Menu className="h-4 w-4" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-60 overflow-y-auto">
                {files.map((file) => {
                  const Icon = fileIcon(file.mimeType);
                  return (
                    <DropdownMenuItem
                      key={file.filePath ?? file.fileName}
                      onClick={() => file.filePath && handleSelectProductTab(file.filePath)}
                    >
                      <Icon className="mr-2 h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{file.fileName}</span>
                    </DropdownMenuItem>
                  );
                })}
                {showWorkflowTab ? (
                  <DropdownMenuItem onClick={handleSelectWorkflowTab}>
                    <span className="truncate">{workflowDetail?.workflowName ?? t('preview.workflowTab')}</span>
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>

            {files.map((file) => {
              if (!file.filePath) return null;
              const isActive = activeTab === 'product' && file.filePath === activeFilePath;
              return (
                <div
                  key={file.filePath}
                  className={stoPreviewArtifactTabClass(isActive)}
                >
                  <button
                    type="button"
                    className="min-w-0 truncate"
                    onClick={() => handleSelectProductTab(file.filePath!)}
                  >
                    {truncateTabLabel(file.fileName)}
                  </button>
                  {onDismissFile ? (
                    <button
                      type="button"
                      className="inline-flex shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                      aria-label={t('preview.dismissTab')}
                      onClick={(event) => {
                        event.stopPropagation();
                        onDismissFile(file.filePath!);
                      }}
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  ) : null}
                </div>
              );
            })}

            {showWorkflowTab ? (
              <button
                type="button"
                className={stoPreviewArtifactTabClass(activeTab === 'workflow')}
                onClick={handleSelectWorkflowTab}
              >
                <span className="truncate">
                  {truncateTabLabel(workflowDetail?.workflowName ?? t('preview.workflowTab'))}
                </span>
              </button>
            ) : null}
          </div>

          <button
            type="button"
            className={cn(stoPreviewActionButtonClass, 'shrink-0')}
            aria-label={t('preview.collapsePanel')}
            onClick={onClose}
          >
            <PanelRightClose className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* 下行：标题/元信息 + 操作按钮 */}
        <div className={stoPreviewActionRowClass}>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-5 text-foreground">{headerTitle}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {activeTab === 'product' ? (
              <>
                <PreviewActionButton onClick={handleFullscreen} aria-label={t('preview.fullscreen')}>
                  <MonitorPlay className="h-4 w-4" aria-hidden />
                </PreviewActionButton>
                <PreviewActionButton onClick={handleRefresh} aria-label={t('preview.refresh')}>
                  <RefreshCw className="h-4 w-4" aria-hidden />
                </PreviewActionButton>
                <PreviewActionButton onClick={handleDownload} aria-label={t('preview.download')}>
                  <Download className="h-4 w-4" aria-hidden />
                </PreviewActionButton>
                <PreviewActionButton onClick={handleOpenExternal} aria-label={t('preview.openExternal')}>
                  <Share2 className="h-4 w-4" aria-hidden />
                </PreviewActionButton>
              </>
            ) : null}
            {activeTab === 'workflow' && showWorkflowTab && workflowId ? (
              <button
                type="button"
                className="shrink-0 text-sm leading-[18px] text-foreground transition-colors hover:text-primary"
                onClick={handleEditWorkflow}
              >
                {t('preview.editWorkflow')}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* legacy file switcher — replaced by tab row (task-4) */}
      {false ? (
        <div className="hidden" aria-hidden />
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-preview-viewer>
        {activeTab === 'product' && activeFile ? (
          <FilePreviewViewer
            key={`${activeFile.filePath}-${refreshKey}`}
            filePath={activeFile.filePath!}
            fileName={activeFile.fileName}
            mimeType={activeFile.mimeType}
            className="h-full w-full"
          />
        ) : activeTab === 'product' ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
            <Eye className="h-8 w-8 opacity-30" aria-hidden />
            <p>{t('preview.emptyHint')}</p>
            <p className="text-xs opacity-50">{t('preview.emptyHintSub')}</p>
          </div>
        ) : showWorkflowTab ? (
          <WorkflowPreviewPanel
            detail={workflowDetail}
            loading={workflowLoading}
            error={workflowError}
            workflowId={workflowId}
          />
        ) : null}
      </div>
    </div>
  );
}

function PreviewActionButton({
  children,
  onClick,
  'aria-label': ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  'aria-label': string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={stoPreviewActionButtonClass}
    >
      {children}
    </button>
  );
}
