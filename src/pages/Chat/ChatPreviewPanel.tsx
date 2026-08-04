/**
 * ChatPreviewPanel — 三栏预览区右侧面板（圆角内容壳 + 文件预览）
 *
 * Tab 行（☰ + 产物 pill）在 ContentHeader 与搜索/刷新等 icon 同一行。
 */
import { useCallback, useMemo, useState } from 'react';
import {
  CloudUpload,
  RefreshCw,
  Download,
  Eye,
  ExternalLink,
} from 'lucide-react';
import { ShareMessageIcon } from '@/components/icons/ShareMessageIcon';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { OnEditWorkflowNavigate } from '@/lib/preview-workflow-navigation';
import { isHttpUrl, inferMimeTypeFromUrl, resolvePreviewMimeType } from '@/lib/preview-url';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { FilePreviewViewer } from '@/components/file-preview/FilePreviewViewer';
import { ArtifactShareDialog } from '@/components/file-preview/ArtifactShareDialog';
import { SaveArtifactDialog } from '@/components/file-preview/SaveArtifactDialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  buildArtifactShareDialogDraft,
  type DingTalkShareDialogDraft,
} from '@/lib/dingtalk-share';
import { isVirtualTaskSessionKey } from '@/stores/chat/cron-session-utils';
import { enrichScheduledTaskArtifactProvenance } from '@/lib/scheduled-task-artifact-provenance';
import {
  stoPreviewActionButtonClass,
  stoPreviewActionRowClass,
  stoPreviewContentShellClass,
} from '@/lib/surfaces';
import { useChatStore, type AttachedFileMeta } from '@/stores/chat';

const previewActionTooltipClass = 'border-none bg-[#1D2129] px-2.5 py-1.5 text-[12px] font-medium leading-4 text-white shadow-none dark:bg-[#1D2129] dark:text-white';

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
  const { t } = useTranslation(['chat', 'common']);
  const [refreshKey, setRefreshKey] = useState(0);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareDraft, setShareDraft] = useState<DingTalkShareDialogDraft | null>(null);
  const [saveArtifactOpen, setSaveArtifactOpen] = useState(false);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);

  const activeFile = useMemo(() => {
    if (!activeFilePath) return null;
    const found = files.find((f) => f.filePath === activeFilePath);
    if (found) return found;
    if (isHttpUrl(activeFilePath)) {
      const inferredMime = inferMimeTypeFromUrl(activeFilePath);
      return {
        filePath: activeFilePath,
        fileName: activeFilePath.replace(/^https?:\/\//, ''),
        mimeType: resolvePreviewMimeType(inferredMime, activeFilePath),
        fileSize: 0,
        preview: null,
      } satisfies AttachedFileMeta;
    }
    return null;
  }, [files, activeFilePath]);

  const saveableActiveFile = useMemo(() => {
    if (!activeFile?.filePath) return activeFile;
    if (activeFile.artifactProvenance) return activeFile;
    const sourceType = isVirtualTaskSessionKey(currentSessionKey) ? 'scheduled_task_artifact' : 'chat_artifact';
    return {
      ...activeFile,
      artifactProvenance: enrichScheduledTaskArtifactProvenance({
        sourceType,
        sessionId: currentSessionKey,
        artifactKey: activeFile.filePath,
      }),
    } satisfies AttachedFileMeta;
  }, [activeFile, currentSessionKey]);

  const handleOpenShareDialog = useCallback(() => {
    if (!activeFile?.filePath) return;
    setShareDraft(buildArtifactShareDialogDraft({
      fileName: activeFile.fileName,
      filePath: activeFile.filePath,
      mimeType: activeFile.mimeType,
      fileSize: activeFile.fileSize,
    }, t));
    setShareDialogOpen(true);
  }, [activeFile, t]);

  const handleShareCompleted = useCallback(() => {
    toast.success(t('preview.shareDialog.success'));
    setShareDialogOpen(false);
    setShareDraft(null);
  }, [t]);

  const handleOpenExternal = useCallback(() => {
    if (!activeFile?.filePath) return;
    if (activeFile.filePath.startsWith('http://') || activeFile.filePath.startsWith('https://')) {
      window.electron.openExternal(activeFile.filePath);
    } else {
      invokeIpc('shell:openPath', activeFile.filePath);
    }
  }, [activeFile]);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleDownload = useCallback(async () => {
    if (!activeFile?.filePath) return;
    const downloadTarget = activeFile.downloadUrl?.trim() || activeFile.filePath;
    if (downloadTarget.startsWith('http://') || downloadTarget.startsWith('https://')) {
      window.electron.openExternal(downloadTarget);
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
                <PreviewActionButton onClick={handleRefresh} aria-label={t('preview.refresh')}>
                  <RefreshCw className="h-4 w-4" aria-hidden />
                </PreviewActionButton>
                <PreviewActionButton onClick={handleDownload} aria-label={t('preview.download')}>
                  <Download className="h-4 w-4" aria-hidden />
                </PreviewActionButton>
                <PreviewActionButton onClick={handleOpenShareDialog} aria-label={t('preview.share')}>
                  <ShareMessageIcon className="h-4 w-4" />
                </PreviewActionButton>
                <PreviewActionButton onClick={handleOpenExternal} aria-label={t('preview.openExternal')}>
                  <ExternalLink className="h-4 w-4" aria-hidden />
                </PreviewActionButton>
                <PreviewActionButton onClick={() => setSaveArtifactOpen(true)} aria-label={t('common:dataCenterPage.saveArtifact.saveToDataCenterTitle')}>
                  <CloudUpload className="h-4 w-4" aria-hidden />
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

      <ArtifactShareDialog
        open={shareDialogOpen}
        draft={shareDraft}
        onShared={handleShareCompleted}
        onCancel={() => {
          setShareDialogOpen(false);
          setShareDraft(null);
        }}
        onError={(error) => {
          toast.error(error instanceof Error ? error.message : t('preview.shareDialog.failed'));
        }}
      />
      {saveArtifactOpen ? (
        <SaveArtifactDialog
          file={saveableActiveFile}
          onClose={() => setSaveArtifactOpen(false)}
          onSaved={() => {
            setSaveArtifactOpen(false);
          }}
        />
      ) : null}
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
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={ariaLabel}
          className={stoPreviewActionButtonClass}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className={previewActionTooltipClass}>
        {ariaLabel}
      </TooltipContent>
    </Tooltip>
  );
}
