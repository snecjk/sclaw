/**
 * ChatPreviewPanel — 三栏预览区右侧面板（仅产物文件）
 *
 * Tab 行在 ContentHeader；此处仅产物内容壳（操作行 + 文件预览）。
 * 收起预览由 ContentHeader 的 preview icon 统一控制。
 */
import { useCallback, useMemo, useState } from 'react';
import {
  RefreshCw,
  Download,
  MonitorPlay,
  Eye,
  Share2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { OnEditWorkflowNavigate } from '@/lib/preview-workflow-navigation';
import { isHttpUrl, inferMimeTypeFromUrl } from '@/lib/preview-url';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { FilePreviewViewer } from '@/components/file-preview/FilePreviewViewer';
import {
  stoPreviewActionButtonClass,
  stoPreviewActionRowClass,
  stoPreviewContentShellClass,
} from '@/lib/surfaces';
import type { AttachedFileMeta } from '@/stores/chat';

export interface ChatPreviewPanelProps {
  /** 当前可见的产物列表（已过滤 dismissed） */
  files: AttachedFileMeta[];
  activeFilePath: string | null;
  /** 有工作流上下文时在操作行展示「编辑工作流」（跳转，不切换预览内容） */
  showEditWorkflow?: boolean;
  workflowId?: string | null;
  onEditWorkflow?: OnEditWorkflowNavigate;
  className?: string;
}

export function ChatPreviewPanel({
  files,
  activeFilePath,
  showEditWorkflow = false,
  workflowId = null,
  onEditWorkflow,
  className,
}: ChatPreviewPanelProps) {
  const { t } = useTranslation('chat');
  const [refreshKey, setRefreshKey] = useState(0);

  const activeFile = useMemo(() => {
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
  }, [files, activeFilePath]);

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
    if (workflowId === null || workflowId === '') return;
    onEditWorkflow?.(workflowId);
  }, [workflowId, onEditWorkflow]);

  if (files.length === 0) return null;

  return (
    <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', className)}>
      <div className={stoPreviewContentShellClass}>
        <div className={stoPreviewActionRowClass}>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-5 text-foreground">
              {activeFile?.fileName ?? t('preview.emptyHint')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {activeFile ? (
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
                {showEditWorkflow && workflowId ? (
                  <button
                    type="button"
                    className="shrink-0 text-sm leading-[18px] text-foreground transition-colors hover:text-primary"
                    onClick={handleEditWorkflow}
                  >
                    {t('preview.editWorkflow')}
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-preview-viewer>
          {activeFile ? (
            <FilePreviewViewer
              key={`${activeFile.filePath}-${refreshKey}`}
              filePath={activeFile.filePath!}
              fileName={activeFile.fileName}
              mimeType={activeFile.mimeType}
              className="h-full w-full"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
              <Eye className="h-8 w-8 opacity-30" aria-hidden />
              <p>{t('preview.emptyHint')}</p>
              <p className="text-xs opacity-50">{t('preview.emptyHintSub')}</p>
            </div>
          )}
        </div>
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
