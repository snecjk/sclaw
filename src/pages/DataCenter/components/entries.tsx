import { useEffect, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CloudUpload, Download, MoreHorizontal, Share2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { actionTooltipClass, ROOT_ENTRY_ID } from '../constants';
import type { DataCenterUiEntry, EntryRenderProps } from '../types';
import { formatBytes, formatDate, getEntryIcon } from '../utils';

export function EntryList(props: EntryRenderProps) {
  const { t } = useTranslation('common');
  return (
    <div className="h-full overflow-auto pr-1">
      <div className="flex flex-col gap-2">
        {props.items.map((entry) => (
          <div
            key={entry.entryId}
            className="flex h-[56px] items-center rounded-[8px] bg-white px-3 shadow-[0_1px_2px_rgba(29,33,41,0.02)] transition-colors hover:bg-[#FAFBFC] dark:bg-card dark:hover:bg-muted/40"
          >
            <div className="min-w-0 flex-1">
              <EntryName entry={entry} onOpenFolder={props.onOpenFolder} onPreview={props.onPreview} />
            </div>
            <div className="w-[168px] shrink-0 text-[12px] leading-5 text-[#6B778C] dark:text-muted-foreground">
              {formatDate(entry.updatedAt)}
            </div>
            <div className="w-[74px] shrink-0 text-[12px] leading-5 text-[#6B778C] dark:text-muted-foreground">
              {entry.entryType === 'folder' ? '-' : formatBytes(entry.fileSize)}
            </div>
            <EntryActions entry={entry} {...props} uploadToSharedLabel={t('dataCenterPage.menu.uploadToShared')} />
          </div>
        ))}
      </div>
    </div>
  );
}

type GridContextMenuState = {
  entry: DataCenterUiEntry;
  x: number;
  y: number;
} | null;

export function EntryGrid(props: EntryRenderProps) {
  const [contextMenu, setContextMenu] = useState<GridContextMenuState>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  const openContextMenu = (event: ReactMouseEvent, entry: DataCenterUiEntry) => {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 132;
    const menuHeight = entry.entryType === 'file' && entry.traceAvailable ? 180 : 140;
    setContextMenu({
      entry,
      x: Math.min(event.clientX, window.innerWidth - menuWidth - 8),
      y: Math.min(event.clientY, window.innerHeight - menuHeight - 8),
    });
  };

  const runContextAction = (action: (entry: DataCenterUiEntry) => void, entry: DataCenterUiEntry) => {
    setContextMenu(null);
    action(entry);
  };

  return (
    <div className="h-full overflow-auto">
      <div className="grid grid-cols-[repeat(auto-fill,72px)] justify-start gap-x-[16px] gap-y-[22px] py-1">
        {props.items.map((entry) => (
          <button
            key={entry.entryId}
            type="button"
            onClick={() => entry.entryType === 'folder' ? props.onOpenFolder(entry) : props.onPreview(entry)}
            onContextMenu={(event) => openContextMenu(event, entry)}
            className="flex w-[72px] flex-col items-center rounded-[8px] px-1 py-1 text-center transition-colors hover:bg-[#F2F3F5] dark:hover:bg-muted/40"
          >
            <span className="flex h-[46px] w-[46px] items-center justify-center">
              {getEntryIcon(entry, 'h-[42px] w-[42px]')}
            </span>
            <span className="mt-1 line-clamp-2 min-h-[34px] w-full break-all text-[13px] font-semibold leading-[17px] text-[#1D2129] dark:text-foreground">
              {entry.name}
            </span>
          </button>
        ))}
      </div>
      {contextMenu ? (
        <GridEntryContextMenu
          entry={contextMenu.entry}
          x={contextMenu.x}
          y={contextMenu.y}
          onDownload={(entry) => runContextAction(props.onDownload, entry)}
          onPreview={(entry) => runContextAction(props.onPreview, entry)}
          onShare={(entry) => runContextAction(props.onShare, entry)}
          onRename={(entry) => runContextAction(props.onRename, entry)}
          onDelete={(entry) => runContextAction(props.onDelete, entry)}
          onTrace={(entry) => runContextAction(props.onTrace, entry)}
        />
      ) : null}
    </div>
  );
}

function GridEntryContextMenu({
  entry,
  x,
  y,
  onDownload,
  onPreview,
  onShare,
  onRename,
  onDelete,
  onTrace,
}: {
  entry: DataCenterUiEntry;
  x: number;
  y: number;
  onDownload: (entry: DataCenterUiEntry) => void;
  onPreview: (entry: DataCenterUiEntry) => void;
  onShare: (entry: DataCenterUiEntry) => void;
  onRename: (entry: DataCenterUiEntry) => void;
  onDelete: (entry: DataCenterUiEntry) => void;
  onTrace: (entry: DataCenterUiEntry) => void;
}) {
  const { t } = useTranslation('common');
  const canRenameEntry = !entry.localAuthorized && (entry.spaceType !== 'site_shared_artifact' || entry.canManage === true);
  const canDeleteEntry = entry.localAuthorized
    ? entry.parentEntryId === ROOT_ENTRY_ID
    : entry.spaceType !== 'site_shared_artifact' || entry.canManage === true;
  const canDownloadEntry = entry.entryType === 'file' && !entry.localAuthorized;
  return (
    <div
      className="fixed z-[70] min-w-[128px] rounded-[10px] border border-[#E5E6EB] bg-white p-2 text-[#1D2129] shadow-[0_8px_24px_rgba(15,23,42,0.14)] dark:border-border dark:bg-popover dark:text-foreground"
      style={{ left: x, top: y }}
      role="menu"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {entry.entryType === 'file' ? (
        <ContextMenuButton onClick={() => onPreview(entry)}>
          {t('dataCenterPage.menu.preview')}
        </ContextMenuButton>
      ) : null}
      {canDownloadEntry ? (
        <ContextMenuButton onClick={() => onDownload(entry)}>
          {t('dataCenterPage.menu.download')}
        </ContextMenuButton>
      ) : null}
      {entry.entryType === 'file' ? (
        <ContextMenuButton onClick={() => onShare(entry)}>
          {t('dataCenterPage.menu.share')}
        </ContextMenuButton>
      ) : null}
      {entry.entryType === 'file' && entry.traceAvailable ? (
        <ContextMenuButton onClick={() => onTrace(entry)}>
          {t('dataCenterPage.menu.traceChat')}
        </ContextMenuButton>
      ) : null}
      {canRenameEntry ? (
        <ContextMenuButton onClick={() => onRename(entry)}>
          {t('dataCenterPage.menu.rename')}
        </ContextMenuButton>
      ) : null}
      {canDeleteEntry ? (
        <ContextMenuButton onClick={() => onDelete(entry)}>
          {entry.localAuthorized ? t('dataCenterPage.menu.removeAuthorization') : t('dataCenterPage.menu.delete')}
        </ContextMenuButton>
      ) : null}
    </div>
  );
}

function ContextMenuButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="block h-9 w-full rounded-[6px] px-3 text-left text-[13px] leading-9 hover:bg-[#F2F3F5] dark:hover:bg-muted"
    >
      {children}
    </button>
  );
}

function EntryName({
  entry,
  onOpenFolder,
  onPreview,
}: {
  entry: DataCenterUiEntry;
  onOpenFolder: (entry: DataCenterUiEntry) => void;
  onPreview: (entry: DataCenterUiEntry) => void;
}) {
  const { t } = useTranslation('common');
  const content = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center">{getEntryIcon(entry, entry.entryType === 'folder' ? 'h-8 w-8' : 'h-7 w-7')}</span>
      <span className="min-w-0 py-1">
        <span className="block truncate text-[13px] font-semibold leading-5 text-[#1D2129] dark:text-foreground">{entry.name}</span>
        {entry.traceStatus === 'pending' ? (
          <span className="inline-flex h-4 items-center rounded bg-[#EEF3FF] px-1.5 text-[11px] leading-4 text-[#4E7FFF]">
            {t('dataCenterPage.entry.tracePending')}
          </span>
        ) : entry.traceAvailable ? (
          <span className="inline-flex h-4 items-center rounded bg-[#F2F3F5] px-1.5 text-[11px] leading-4 text-[#6B778C]">
            {t('dataCenterPage.entry.traceAvailable')}
          </span>
        ) : null}
      </span>
    </>
  );
  if (entry.entryType === 'folder') {
    return (
      <button type="button" onClick={() => onOpenFolder(entry)} className="flex min-w-0 items-center gap-3 text-left">
        {content}
      </button>
    );
  }
  return (
    <button type="button" onClick={() => onPreview(entry)} className="flex min-w-0 items-center gap-3 text-left">
      {content}
    </button>
  );
}

function EntryActions({
  entry,
  onPreview,
  onDownload,
  onShare,
  onUploadToShared,
  onRename,
  onDelete,
  onTrace,
  uploadToSharedLabel,
}: EntryRenderProps & { entry: DataCenterUiEntry; uploadToSharedLabel?: string }) {
  const { t } = useTranslation('common');
  const canUploadToShared = entry.entryType === 'file' && entry.spaceType === 'qa_artifact' && !entry.localAuthorized;
  const canRenameEntry = !entry.localAuthorized && (entry.spaceType !== 'site_shared_artifact' || entry.canManage === true);
  const canDeleteEntry = entry.localAuthorized
    ? entry.parentEntryId === ROOT_ENTRY_ID
    : entry.spaceType !== 'site_shared_artifact' || entry.canManage === true;
  const canDownloadEntry = entry.entryType === 'file' && !entry.localAuthorized;
  return (
    <div className="flex w-[128px] shrink-0 items-center justify-end gap-1 text-[#6B778C]">
      {canUploadToShared ? (
        <ActionTooltip label={uploadToSharedLabel ?? ''}>
          <button
            type="button"
            onClick={() => onUploadToShared(entry)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-[#F2F3F5] hover:text-[#1D2129]"
            aria-label={uploadToSharedLabel}
          >
            <CloudUpload className="h-4 w-4" />
          </button>
        </ActionTooltip>
      ) : null}
      {canDownloadEntry ? (
        <ActionTooltip label={t('dataCenterPage.menu.download')}>
          <button
            type="button"
            onClick={() => onDownload(entry)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-[#F2F3F5] hover:text-[#1D2129]"
            aria-label={t('dataCenterPage.menu.download')}
          >
            <Download className="h-4 w-4" />
          </button>
        </ActionTooltip>
      ) : null}
      {entry.entryType === 'file' ? (
        <ActionTooltip label={t('dataCenterPage.menu.share')}>
          <button
            type="button"
            onClick={() => onShare(entry)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-[#F2F3F5] hover:text-[#1D2129]"
            aria-label={t('dataCenterPage.menu.share')}
          >
            <Share2 className="h-4 w-4" />
          </button>
        </ActionTooltip>
      ) : null}
      <DropdownMenu>
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-[#F2F3F5] hover:text-[#1D2129]" aria-label={t('dataCenterPage.menu.more')}>
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6} className={actionTooltipClass}>
            {t('dataCenterPage.menu.more')}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="min-w-[128px] rounded-[10px] p-2">
          {entry.entryType === 'file' ? (
            <DropdownMenuItem onSelect={() => onPreview(entry)} className="text-[13px]">
              {t('dataCenterPage.menu.preview')}
            </DropdownMenuItem>
          ) : null}
          {entry.entryType === 'file' && entry.traceAvailable ? (
            <DropdownMenuItem onSelect={() => onTrace(entry)} className="text-[13px]">
              {t('dataCenterPage.menu.traceChat')}
            </DropdownMenuItem>
          ) : null}
          {canRenameEntry ? (
            <DropdownMenuItem onSelect={() => onRename(entry)} className="text-[13px]">
              {t('dataCenterPage.menu.rename')}
            </DropdownMenuItem>
          ) : null}
          {canDeleteEntry ? (
            <DropdownMenuItem onSelect={() => onDelete(entry)} className="text-[13px]">
              {entry.localAuthorized ? t('dataCenterPage.menu.removeAuthorization') : t('dataCenterPage.menu.delete')}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ActionTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className={actionTooltipClass}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function FeedbackState({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="flex h-full min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background text-center">
      <div className="text-muted-foreground">{icon}</div>
      <h2 className="mt-4 text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
