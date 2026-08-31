/**
 * ChatPreviewHeaderTabs — ContentHeader 预览列统一 tab 行
 *
 * 文件产物 + 业务网页混排（对齐 Kimi Work 预览面板），☰ 溢出菜单在左，
 * tab 带类型图标 + 关闭钮，与右侧操作 icon 同一 44px 行。
 */
import {
  X,
  FileText,
  FileCode,
  File,
  Globe,
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
import type { ChatPreviewTab } from '@/hooks/use-chat-preview-panel';

export interface ChatPreviewHeaderTabsProps {
  /** 统一 tab 序列（文件产物 + 业务网页） */
  tabs: ChatPreviewTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  /** 关闭单个 tab */
  onDismissTab?: (tabId: string) => void;
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

function tabIcon(tab: ChatPreviewTab) {
  return tab.kind === 'browser' ? Globe : fileIcon(tab.file.mimeType);
}

function tabLabel(tab: ChatPreviewTab): string {
  return tab.kind === 'browser' ? tab.tab.title : tab.file.fileName;
}

function truncateTabLabel(name: string, maxLen = 8): string {
  if (name.length <= maxLen) return name;
  return `${name.slice(0, maxLen)}...`;
}

export function ChatPreviewHeaderTabs({
  tabs,
  activeTabId,
  onSelectTab,
  onDismissTab,
  className,
}: ChatPreviewHeaderTabsProps) {
  const { t } = useTranslation('chat');

  if (tabs.length === 0) return null;

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
        {tabs.map((tab) => {
          const Icon = tabIcon(tab);
          return (
            <DropdownMenuItem
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
            >
              <Icon className="mr-2 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{tabLabel(tab)}</span>
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
        {tabs.map((tab) => {
          const Icon = tabIcon(tab);
          const isActive = tab.id === activeTabId;
          return (
            <div key={tab.id} className={stoPreviewArtifactTabClass(isActive)}>
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <button
                type="button"
                className={cn(contentHeaderPreviewArtifactTabBtnClass, 'truncate')}
                onClick={() => onSelectTab(tab.id)}
              >
                {truncateTabLabel(tabLabel(tab))}
              </button>
              {onDismissTab ? (
                <button
                  type="button"
                  className={cn(
                    contentHeaderPreviewArtifactTabBtnClass,
                    'h-6 w-6 shrink-0 justify-center text-muted-foreground hover:text-foreground',
                  )}
                  aria-label={t('preview.dismissTab')}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDismissTab(tab.id);
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
