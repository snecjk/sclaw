/**
 * ChatPreviewHeaderTabs — ContentHeader 预览列 tab 行（☰ 在左 + tab，与右侧 icon 同栏）
 *
 * 左缘与下方 stoPreviewContentShellClass 对齐（共用三栏 grid 预览列宽）。
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
import {
  contentHeaderActionBtnClass,
  contentHeaderPreviewArtifactTabBtnClass,
  contentHeaderPreviewTabsRowClass,
  contentHeaderPreviewTabsWrapClass,
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
  className,
}: ChatPreviewHeaderTabsProps) {
  const { t } = useTranslation('chat');

  if (files.length === 0) return null;

  const overflowMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(contentHeaderActionBtnClass, 'shrink-0')}
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
  );

  return (
    <div className={cn(contentHeaderPreviewTabsRowClass, className)}>
      {overflowMenu}

      <div className={contentHeaderPreviewTabsWrapClass}>
        {files.map((file) => {
          if (!file.filePath) return null;
          const isActive = file.filePath === activeFilePath;
          return (
            <div key={file.filePath} className={stoPreviewArtifactTabClass(isActive)}>
              <button
                type="button"
                className={cn(contentHeaderPreviewArtifactTabBtnClass, 'truncate')}
                onClick={() => onSelectFile(file.filePath!)}
              >
                {truncateTabLabel(file.fileName)}
              </button>
              {onDismissFile ? (
                <button
                  type="button"
                  className={cn(
                    contentHeaderPreviewArtifactTabBtnClass,
                    'h-6 w-6 shrink-0 justify-center text-muted-foreground hover:text-foreground',
                  )}
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
      </div>
    </div>
  );
}
