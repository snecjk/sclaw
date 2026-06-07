/**
 * Chat Preview Panel
 * Right-hand side panel for previewing locally-generated files (HTML, PDFs, Office docs, web links)
 * attached to chat messages. Supports tab switching between files.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  X,
  ExternalLink,
  RefreshCw,
  Download,
  Maximize2,
  FileText,
  FileCode,
  File,
  ChevronDown,
  Presentation,
  Table2,
  MonitorPlay,
  Eye,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { FilePreviewViewer } from '@/components/file-preview/FilePreviewViewer';
import type { AttachedFileMeta } from '@/stores/chat';

interface ChatPreviewPanelProps {
  files: AttachedFileMeta[];
  activeFilePath: string | null;
  onSelectFile: (filePath: string) => void;
  onClose: () => void;
  className?: string;
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

export function ChatPreviewPanel({
  files,
  activeFilePath,
  onSelectFile,
  onClose,
  className,
}: ChatPreviewPanelProps) {
  const [activeTab, setActiveTab] = useState<PreviewTab>('product');
  const [showFileList, setShowFileList] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const activeFile = useMemo(
    () => files.find((f) => f.filePath === activeFilePath) || null,
    [files, activeFilePath],
  );

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
      // Fallback to opening externally
      handleOpenExternal();
    }
  }, [activeFile, handleOpenExternal]);

  if (files.length === 0) return null;

  return (
    <div
      className={cn(
        'flex min-h-0 min-w-0 flex-col border-l border-border/40 bg-[var(--sto-page-bg)] dark:bg-background',
        className,
      )}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/40 px-4 py-3">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab('product')}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              activeTab === 'product'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            产物
          </button>
          <button
            onClick={() => setActiveTab('workflow')}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              activeTab === 'workflow'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            工作流
          </button>
        </div>
        <div className="flex items-center gap-1">
          {activeTab === 'product' && (
            <>
              <ActionButton onClick={handleFullscreen} title="全屏放映">
                <MonitorPlay className="h-3.5 w-3.5" />
              </ActionButton>
              <ActionButton onClick={handleRefresh} title="刷新">
                <RefreshCw className="h-3.5 w-3.5" />
              </ActionButton>
              <ActionButton onClick={handleDownload} title="下载">
                <Download className="h-3.5 w-3.5" />
              </ActionButton>
              <ActionButton onClick={handleOpenExternal} title="在浏览器中打开">
                <ExternalLink className="h-3.5 w-3.5" />
              </ActionButton>
            </>
          )}
          <ActionButton onClick={onClose} title="关闭">
            <X className="h-3.5 w-3.5" />
          </ActionButton>
        </div>
      </div>

      {/* File switcher */}
      {activeTab === 'product' && files.length > 1 && (
        <div className="shrink-0 border-b border-border/30 px-4 py-2">
          <button
            onClick={() => setShowFileList((v) => !v)}
            className="flex w-full items-center gap-2 rounded-lg border border-border/30 bg-white/[0.04] px-3 py-2 text-left text-xs transition-colors hover:bg-white/[0.08]"
          >
            {activeFile && (() => {
              const Icon = fileIcon(activeFile.mimeType);
              return <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
            })()}
            <span className="flex-1 truncate text-foreground">
              {activeFile?.fileName || '选择文件'}
            </span>
            <ChevronDown
              className={cn(
                'h-3 w-3 shrink-0 text-muted-foreground transition-transform',
                showFileList && 'rotate-180',
              )}
            />
          </button>
          <AnimatePresence>
            {showFileList && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden"
              >
                <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-border/30 bg-popover shadow-md">
                  {files.map((file) => {
                    const Icon = fileIcon(file.mimeType);
                    const isActive = file.filePath === activeFile?.filePath;
                    return (
                      <button
                        key={file.filePath || file.fileName}
                        onClick={() => {
                          onSelectFile(file.filePath!);
                          setShowFileList(false);
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors',
                          isActive
                            ? 'bg-primary/10 text-primary'
                            : 'text-foreground hover:bg-accent',
                        )}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate">{file.fileName}</span>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Content */}
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
            <Eye className="h-8 w-8 opacity-30" />
            <p>点击消息中的文件链接进行预览</p>
            <p className="text-xs opacity-50">或从上方下拉菜单选择文件</p>
          </div>
        ) : (
          <WorkflowPlaceholder />
        )}
      </div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  );
}

function WorkflowPlaceholder() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground px-6 text-center">
      <Maximize2 className="h-8 w-8 opacity-30" />
      <p>工作流预览即将推出</p>
    </div>
  );
}
