/**
 * ChatPreviewHeaderTabs — 三栏预览产物 tab 行（与 ContentHeader icon 同高对齐）
 *
 * 仅产物文件 tab + 可选「编辑工作流」跳转入口；不在产物区展示工作流详情。
 * 使用位置：ContentHeader.previewTabs（Home / Chat）；TaskSubitem 预览列顶行。
 */
import {
  X,
  FileText,
  FileCode,
  File,
  Menu,
  Presentation,
  Table2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { OnEditWorkflowNavigate } from '@/lib/preview-workflow-navigation';
import {
  contentHeaderPreviewTabsWrapClass,
  stoPreviewActionButtonClass,
  stoPreviewArtifactTabClass,
} from '@/lib/surfaces';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AttachedFileMeta } from '@/stores/chat';

export interface ChatPreviewHeaderTabsProps {
  /** 当前可见的产物列表 */
  files: AttachedFileMeta[];
  activeFilePath: string | null;
  onSelectFile: (filePath: string) => void;
  /** 关闭单个产物 tab */
  onDismissFile?: (filePath: string) => void;
  /** 有工作流上下文时展示「编辑工作流」（仅跳转，不切换预览内容） */
  showEditWorkflow?: boolean;
  workflowId?: string | null;
  onEditWorkflow?: OnEditWorkflowNavigate;
  className?: string;
}

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

export function ChatPreviewHeaderTabs({
  files,
  activeFilePath,
  onSelectFile,
  onDismissFile,
  showEditWorkflow = false,
  workflowId = null,
  onEditWorkflow,
  className,
}: ChatPreviewHeaderTabsProps) {
  const { t } = useTranslation('chat');

  if (files.length === 0 && !showEditWorkflow) return null;

  const handleEditWorkflow = () => {
    if (workflowId === null || workflowId === '') return;
    onEditWorkflow?.(workflowId);
  };

  return (
    <div className={cn(contentHeaderPreviewTabsWrapClass, className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(stoPreviewActionButtonClass, 'shrink-0')}
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
                onClick={() => file.filePath && onSelectFile(file.filePath)}
              >
                <Icon className="mr-2 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">{file.fileName}</span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {files.map((file) => {
        if (!file.filePath) return null;
        const isActive = file.filePath === activeFilePath;
        return (
          <div key={file.filePath} className={stoPreviewArtifactTabClass(isActive)}>
            <button
              type="button"
              className="min-w-0 truncate"
              onClick={() => onSelectFile(file.filePath!)}
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

      {showEditWorkflow && workflowId ? (
        <button
          type="button"
          className="shrink-0 text-sm leading-[18px] text-foreground transition-colors hover:text-primary"
          onClick={handleEditWorkflow}
        >
          {t('preview.editWorkflow')}
        </button>
      ) : null}
    </div>
  );
}
