/**
 * ChatPreviewPanel — 统一预览面板（Kimi Work 式右侧面板）
 *
 * 单一 L2 壳内按活跃 tab 类型切换内容：
 * - file    → 操作行（刷新/下载/分享/打开/存数据中心/编辑工作流）+ FilePreviewViewer
 * - browser → BrowserPreviewView（自带 chrome：导航/地址栏/进度条）
 *
 * Tab 行（文件 + 网页混排 pill）由 ChatPreviewHeaderTabs 渲染在 ContentHeader。
 */
import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
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
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { FilePreviewViewer } from '@/components/file-preview/FilePreviewViewer';
import { ArtifactShareDialog } from '@/components/file-preview/ArtifactShareDialog';
import { SaveArtifactDialog } from '@/components/file-preview/SaveArtifactDialog';
import { BrowserPreviewView } from '@/components/chat-browser/BrowserPreviewView';
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
import type { ChatBrowserPreviewTab } from '@/stores/chat-browser-preview';
import type { ChatPreviewTab } from '@/hooks/use-chat-preview-panel';

const previewActionTooltipClass = 'border-none bg-[#1D2129] px-2.5 py-1.5 text-[12px] font-medium leading-4 text-white shadow-none dark:bg-[#1D2129] dark:text-white';

export interface ChatPreviewPanelProps {
  /** 统一 tab 序列（文件产物 + 业务网页） */
  tabs: ChatPreviewTab[];
  activeTabId: string | null;
  sessionKey: string;
  /** 有工作流上下文时在操作行展示「编辑工作流」（跳转，不切换预览内容） */
  showEditWorkflow?: boolean;
  workflowId?: string | null;
  onEditWorkflow?: OnEditWorkflowNavigate;
  className?: string;
  isPreviewOverlay?: boolean;
}

export function ChatPreviewPanel({
  tabs,
  activeTabId,
  sessionKey,
  showEditWorkflow = false,
  workflowId = null,
  onEditWorkflow,
  className,
  isPreviewOverlay = false,
}: ChatPreviewPanelProps) {
  const { t } = useTranslation(['chat', 'common']);
  const [refreshKey, setRefreshKey] = useState(0);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareDraft, setShareDraft] = useState<DingTalkShareDialogDraft | null>(null);
  const [saveArtifactOpen, setSaveArtifactOpen] = useState(false);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[tabs.length - 1] ?? null,
    [tabs, activeTabId],
  );

  const activeFile: AttachedFileMeta | null = activeTab?.kind === 'file' ? activeTab.file : null;

  const browserTabs = useMemo(
    () => tabs.filter((tab): tab is Extract<ChatPreviewTab, { kind: 'browser' }> => tab.kind === 'browser').map((tab) => tab.tab),
    [tabs],
  );
  const activeBrowserTabId = activeTab?.kind === 'browser' ? activeTab.tab.id : null;

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

  if (tabs.length === 0) return null;

  return (
    <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', className)}>
      <div className={stoPreviewContentShellClass}>
        {activeTab?.kind === 'browser' ? (
          <BrowserPreviewView
            sessionKey={sessionKey}
            tabs={browserTabs as ChatBrowserPreviewTab[]}
            activeTabId={activeBrowserTabId}
            className="min-h-0 flex-1"
          />
        ) : (
          <>
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

            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-preview-viewer>
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
          </>
        )}
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
      {saveArtifactOpen ? createPortal(
        <SaveArtifactDialog
          escapeDismiss={isPreviewOverlay}
          file={saveableActiveFile}
          onClose={() => setSaveArtifactOpen(false)}
          onSaved={() => {
            setSaveArtifactOpen(false);
          }}
        />,
        document.body,
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
