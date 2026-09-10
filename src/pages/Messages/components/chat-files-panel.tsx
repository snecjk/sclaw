import {
  ArrowDown,
  FileSpreadsheet,
  FileText,
  Link2,
  MoreHorizontal,
  Play,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconCheckbox } from '@/components/icon-checkbox';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { IMChatFileItem, IMChatFileTab, IMChatFileType } from '../types';

function FileTypeIcon({ fileType }: { fileType: IMChatFileType }) {
  const iconClass = 'h-5 w-5';

  if (fileType === 'video') {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#E8F3FF] text-[#1677FF]">
        <Play className={iconClass} fill="currentColor" strokeWidth={0} />
      </div>
    );
  }

  if (fileType === 'spreadsheet') {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#E8F7EF] text-[#00A870]">
        <FileSpreadsheet className={iconClass} strokeWidth={1.75} />
      </div>
    );
  }

  if (fileType === 'link') {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#F2F3F5] text-[#4E5969]">
        <Link2 className={iconClass} strokeWidth={1.75} />
      </div>
    );
  }

  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#E8F3FF] text-[#1677FF]">
      <FileText className={iconClass} strokeWidth={1.75} />
    </div>
  );
}

function ChatFileRow({
  item,
  checked,
  onToggle,
}: {
  item: IMChatFileItem;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-[var(--sto-content-hover-background)]"
    >
      <IconCheckbox checked={checked} onCheckedChange={() => onToggle()} />
      <FileTypeIcon fileType={item.fileType} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium leading-5 text-foreground">{item.name}</div>
        <div className="mt-0.5 truncate text-[12px] leading-5 text-muted-foreground">{item.metaLine}</div>
      </div>
    </button>
  );
}

const TAB_ORDER: IMChatFileTab[] = ['files', 'media', 'links'];

export function ChatFilesPanel({
  open,
  files,
  onOpenChange,
}: {
  open: boolean;
  files: IMChatFileItem[];
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('common');
  const [activeTab, setActiveTab] = useState<IMChatFileTab>('files');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const visibleFiles = useMemo(
    () => files.filter((item) => item.tab === activeTab),
    [activeTab, files],
  );

  const toggleItem = (id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const tabLabel = (tab: IMChatFileTab) => {
    switch (tab) {
      case 'files':
        return t('im.chatFilesTabFiles');
      case 'media':
        return t('im.chatFilesTabMedia');
      case 'links':
        return t('im.chatFilesTabLinks');
      default:
        return tab;
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[min(420px,92vw)] max-w-[420px] flex-col gap-0 overflow-hidden border-l border-border bg-[var(--sto-main-card-bg)] p-0 sm:max-w-[420px]"
      >
        <SheetTitle className="sr-only">{t('im.chatFiles')}</SheetTitle>

        <div className="flex items-center justify-between border-b border-border px-4 pt-4">
          <div className="flex min-w-0 items-center gap-5">
            {TAB_ORDER.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'relative pb-3 text-[14px] font-medium transition-colors',
                  activeTab === tab
                    ? 'text-[var(--sto-brand-6)]'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {tabLabel(tab)}
                {activeTab === tab ? (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-[var(--sto-brand-6)]" />
                ) : null}
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mb-2 h-8 w-8 shrink-0"
            onClick={() => onOpenChange(false)}
            aria-label={t('actions.close')}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="border-b border-border bg-[var(--sto-surface-muted)] px-4 py-3 text-[12px] leading-5 text-muted-foreground">
          {t('im.chatFilesRetentionHint')}
          <button type="button" className="ml-1 text-[var(--sto-brand-6)] hover:underline">
            {t('im.chatFilesAddToDocs')}
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <Button type="button" size="sm" className="h-8 gap-1.5 px-3">
            <Upload className="h-4 w-4" strokeWidth={1.75} />
            {t('im.chatFilesUpload')}
          </Button>
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-[13px] text-muted-foreground">
              <Search className="h-4 w-4" strokeWidth={1.75} />
              {t('im.search')}
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label={t('im.chatFilesRecycleBin')}>
              <Trash2 className="h-4 w-4" strokeWidth={1.75} />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label={t('im.more')}>
              <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-2.5 text-[12px] text-muted-foreground">
          <span>{t('im.chatFilesSortRecent')}</span>
          <ArrowDown className="h-3.5 w-3.5" />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {visibleFiles.length > 0 ? (
            visibleFiles.map((item) => (
              <ChatFileRow
                key={item.id}
                item={item}
                checked={selectedIds.includes(item.id)}
                onToggle={() => toggleItem(item.id)}
              />
            ))
          ) : (
            <div className="px-4 py-12 text-center text-[13px] text-muted-foreground">
              {t('im.chatFilesEmpty')}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
