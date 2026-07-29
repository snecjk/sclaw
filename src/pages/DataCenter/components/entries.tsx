import { useEffect, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import downloadIcon from '@/assets/icons/download-icon.svg';
import shareIcon from '@/assets/icons/share-icon.svg';
import uploadIcon from '@/assets/icons/upload-icon.svg';
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
import { cn } from '@/lib/utils';
import { actionTooltipClass } from '../constants';
import type { DataCenterUiEntry, EntryRenderProps } from '../types';
import { formatBytes, formatDate, getEntryIcon } from '../utils';

const DRAG_ENTRY_MIME = 'application/x-sclaw-data-center-entry';

export function EntryList(props: EntryRenderProps) {
  const { t } = useTranslation('common');
  const [draggingEntryId, setDraggingEntryId] = useState<string | null>(null);
  const [dragOverEntryId, setDragOverEntryId] = useState<string | null>(null);

  const getDraggedEntry = (event: ReactDragEvent): DataCenterUiEntry | null => {
    const entryId = event.dataTransfer.getData(DRAG_ENTRY_MIME) || draggingEntryId;
    return props.items.find((item) => item.entryId === entryId) ?? null;
  };

  const canDropOnFolder = (source: DataCenterUiEntry | null, target: DataCenterUiEntry): source is DataCenterUiEntry => {
    if (!source || source.localAuthorized) return false;
    if (target.entryType !== 'folder' || target.localAuthorized || target.shared === true) return false;
    if (source.entryId === target.entryId || source.parentEntryId === target.entryId) return false;
    return true;
  };

  const startDrag = (event: ReactDragEvent, entry: DataCenterUiEntry) => {
    if (entry.localAuthorized) {
      event.preventDefault();
      return;
    }
    setDraggingEntryId(entry.entryId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(DRAG_ENTRY_MIME, entry.entryId);
    event.dataTransfer.setData('text/plain', entry.name);
  };

  const finishDrag = () => {
    setDraggingEntryId(null);
    setDragOverEntryId(null);
  };

  return (
    <div className="h-full overflow-auto pr-1">
      <div className="flex flex-col gap-2">
        {props.items.map((entry) => {
          const dropActive = dragOverEntryId === entry.entryId;
          return (
            <div
              key={entry.entryId}
              draggable={!entry.localAuthorized}
              onDragStart={(event) => startDrag(event, entry)}
              onDragEnd={finishDrag}
              onDragOver={(event) => {
                if (!canDropOnFolder(getDraggedEntry(event), entry)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDragOverEntryId(entry.entryId);
              }}
              onDragLeave={() => {
                if (dragOverEntryId === entry.entryId) setDragOverEntryId(null);
              }}
              onDrop={(event) => {
                const source = getDraggedEntry(event);
                finishDrag();
                if (!canDropOnFolder(source, entry)) return;
                event.preventDefault();
                props.onMoveToFolder(source, entry);
              }}
              className={cn(
                'grid h-[56px] grid-cols-[minmax(0,1fr)_128px] items-center rounded-[8px] bg-white px-3 shadow-[0_1px_2px_rgba(29,33,41,0.02)] transition-colors hover:bg-[#FAFBFC] min-[720px]:grid-cols-[minmax(0,1fr)_140px_64px_128px] min-[900px]:grid-cols-[minmax(0,1fr)_168px_74px_128px] dark:bg-card dark:hover:bg-muted/40',
                draggingEntryId === entry.entryId && 'opacity-60',
                dropActive && 'bg-[#EAF3FF] ring-1 ring-[#4E7FFF] dark:bg-primary/10',
              )}
            >
              <div className="min-w-0 flex-1">
                <EntryName entry={entry} onOpenFolder={props.onOpenFolder} onPreview={props.onPreview} />
              </div>
              <div className="hidden min-[720px]:block text-[12px] leading-5 text-[#6B778C] dark:text-muted-foreground">
                {formatDate(entry.updatedAt)}
              </div>
              <div className="hidden min-[720px]:block text-[12px] leading-5 text-[#6B778C] dark:text-muted-foreground">
                {entry.entryType === 'folder' ? '-' : formatBytes(entry.fileSize)}
              </div>
              <EntryActions entry={entry} {...props} uploadToSharedLabel={t('dataCenterPage.menu.uploadToShared')} />
            </div>
          );
        })}
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
  const [draggingEntryId, setDraggingEntryId] = useState<string | null>(null);
  const [dragOverEntryId, setDragOverEntryId] = useState<string | null>(null);

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
    if (!hasContextMenuActions(entry)) return;
    const menuWidth = 132;
    const menuHeight = canTraceChat(entry) ? 216 : 176;
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

  const getDraggedEntry = (event: ReactDragEvent): DataCenterUiEntry | null => {
    const entryId = event.dataTransfer.getData(DRAG_ENTRY_MIME) || draggingEntryId;
    return props.items.find((item) => item.entryId === entryId) ?? null;
  };

  const canDropOnFolder = (source: DataCenterUiEntry | null, target: DataCenterUiEntry): source is DataCenterUiEntry => {
    if (!source || source.localAuthorized) return false;
    if (target.entryType !== 'folder' || target.localAuthorized || target.shared === true) return false;
    if (source.entryId === target.entryId || source.parentEntryId === target.entryId) return false;
    return true;
  };

  const startDrag = (event: ReactDragEvent, entry: DataCenterUiEntry) => {
    if (entry.localAuthorized) {
      event.preventDefault();
      return;
    }
    setContextMenu(null);
    setDraggingEntryId(entry.entryId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(DRAG_ENTRY_MIME, entry.entryId);
    event.dataTransfer.setData('text/plain', entry.name);
  };

  const finishDrag = () => {
    setDraggingEntryId(null);
    setDragOverEntryId(null);
  };

  return (
    <div className="h-full overflow-auto">
      <div className="grid grid-cols-[repeat(auto-fill,72px)] justify-start gap-x-[16px] gap-y-[22px] py-1">
        {props.items.map((entry) => {
          const dropActive = dragOverEntryId === entry.entryId;
          return (
            <button
              key={entry.entryId}
              type="button"
              draggable={!entry.localAuthorized}
              onDragStart={(event) => startDrag(event, entry)}
              onDragEnd={finishDrag}
              onDragOver={(event) => {
                if (!canDropOnFolder(getDraggedEntry(event), entry)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDragOverEntryId(entry.entryId);
              }}
              onDragLeave={() => {
                if (dragOverEntryId === entry.entryId) setDragOverEntryId(null);
              }}
              onDrop={(event) => {
                const source = getDraggedEntry(event);
                finishDrag();
                if (!canDropOnFolder(source, entry)) return;
                event.preventDefault();
                props.onMoveToFolder(source, entry);
              }}
              onClick={() => entry.entryType === 'folder' ? props.onOpenFolder(entry) : props.onPreview(entry)}
              onContextMenu={(event) => openContextMenu(event, entry)}
              className={cn(
                'flex w-[72px] flex-col items-center rounded-[8px] px-1 py-1 text-center transition-colors hover:bg-[#F2F3F5] dark:hover:bg-muted/40',
                draggingEntryId === entry.entryId && 'opacity-60',
                dropActive && 'bg-[#EAF3FF] ring-1 ring-[#4E7FFF] dark:bg-primary/10',
              )}
            >
              <span className="flex h-[46px] w-[46px] items-center justify-center">
                {getEntryIcon(entry, 'h-[42px] w-[42px]')}
              </span>
              <span className="mt-1 line-clamp-2 min-h-[34px] w-full break-all text-[13px] font-semibold leading-[17px] text-[#1D2129] dark:text-foreground">
                {entry.name}
              </span>
            </button>
          );
        })}
      </div>
      {contextMenu ? (
        <GridEntryContextMenu
          entry={contextMenu.entry}
          x={contextMenu.x}
          y={contextMenu.y}
          onDownload={(entry) => runContextAction(props.onDownload, entry)}
          onPreview={(entry) => runContextAction(props.onPreview, entry)}
          onShare={(entry) => runContextAction(props.onShare, entry)}
          onMove={(entry) => runContextAction(props.onMove, entry)}
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
  onMove,
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
  onMove: (entry: DataCenterUiEntry) => void;
  onRename: (entry: DataCenterUiEntry) => void;
  onDelete: (entry: DataCenterUiEntry) => void;
  onTrace: (entry: DataCenterUiEntry) => void;
}) {
  const { t } = useTranslation('common');
  const canMoveEntry = canMove(entry);
  const canRenameEntry = canRename(entry);
  const canDeleteEntry = canDelete(entry);
  const canDownloadEntry = canDownload(entry);
  const canTraceEntry = canTraceChat(entry);
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
      {canTraceEntry ? (
        <ContextMenuButton onClick={() => onTrace(entry)}>
          {t('dataCenterPage.menu.traceChat')}
        </ContextMenuButton>
      ) : null}
      {canMoveEntry ? (
        <ContextMenuButton onClick={() => onMove(entry)}>
          {t('dataCenterPage.menu.moveTo')}
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
  const sourceLabel = entry.sourceType === 'scheduled_task_artifact'
    ? t('dataCenterPage.entry.scheduledTask')
    : null;
  const content = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center">{getEntryIcon(entry, entry.entryType === 'folder' ? 'h-8 w-8' : 'h-7 w-7')}</span>
      <span className="min-w-0 py-1">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-[13px] font-semibold leading-5 text-[#1D2129] dark:text-foreground">{entry.name}</span>
          {sourceLabel ? (
            <span className="shrink-0 rounded-[4px] bg-[#EEF3FF] px-1.5 py-0.5 text-[11px] font-medium leading-[14px] text-[#4E7FFF]">
              {sourceLabel}
            </span>
          ) : null}
        </span>
      </span>
    </>
  );
  if (entry.entryType === 'folder') {
    return (
      <button type="button" onClick={() => onOpenFolder(entry)} className="flex w-full min-w-0 items-center gap-3 text-left">
        {content}
      </button>
    );
  }
  return (
    <button type="button" onClick={() => onPreview(entry)} className="flex w-full min-w-0 items-center gap-3 text-left">
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
  onMove,
  onRename,
  onDelete,
  onTrace,
  uploadToSharedLabel,
}: EntryRenderProps & { entry: DataCenterUiEntry; uploadToSharedLabel?: string }) {
  const { t } = useTranslation('common');
  const [moreTooltipOpen, setMoreTooltipOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const canUploadToShared = entry.entryType === 'file' && entry.spaceType === 'qa_artifact' && !entry.localAuthorized;
  const canMoveEntry = canMove(entry);
  const canRenameEntry = canRename(entry);
  const canDeleteEntry = canDelete(entry);
  const canDownloadEntry = canDownload(entry);
  const canTraceEntry = canTraceChat(entry);
  const canShowMore = hasMoreMenuActions(entry);
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
            <img src={uploadIcon} alt="" aria-hidden="true" className="h-4 w-4" />
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
            <img src={downloadIcon} alt="" aria-hidden="true" className="h-4 w-4" />
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
            <img src={shareIcon} alt="" aria-hidden="true" className="h-4 w-4" />
          </button>
        </ActionTooltip>
      ) : null}
      {canShowMore ? (
        <DropdownMenu
          open={moreMenuOpen}
          onOpenChange={(open) => {
            setMoreMenuOpen(open);
            setMoreTooltipOpen(false);
          }}
        >
          <Tooltip open={moreTooltipOpen && !moreMenuOpen} delayDuration={200}>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-[#F2F3F5] hover:text-[#1D2129]"
                  aria-label={t('dataCenterPage.menu.more')}
                  onMouseEnter={() => setMoreTooltipOpen(true)}
                  onMouseLeave={() => setMoreTooltipOpen(false)}
                  onFocus={() => setMoreTooltipOpen(false)}
                  onClick={(event) => {
                    setMoreTooltipOpen(false);
                    event.currentTarget.blur();
                  }}
                >
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
            {canTraceEntry ? (
              <DropdownMenuItem onSelect={() => onTrace(entry)} className="text-[13px]">
                {t('dataCenterPage.menu.traceChat')}
              </DropdownMenuItem>
            ) : null}
            {canMoveEntry ? (
              <DropdownMenuItem onSelect={() => onMove(entry)} className="text-[13px]">
                {t('dataCenterPage.menu.moveTo')}
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
      ) : null}
    </div>
  );
}

function canMove(entry: DataCenterUiEntry): boolean {
  return !entry.localAuthorized;
}

function canRename(entry: DataCenterUiEntry): boolean {
  return !entry.localAuthorized && (entry.spaceType !== 'site_shared_artifact' || entry.canManage === true);
}

function canDelete(entry: DataCenterUiEntry): boolean {
  return entry.localAuthorized
    ? true
    : entry.spaceType !== 'site_shared_artifact' || entry.canManage === true;
}

function canDownload(entry: DataCenterUiEntry): boolean {
  return entry.entryType === 'file' && !entry.localAuthorized;
}

function hasMoreMenuActions(entry: DataCenterUiEntry): boolean {
  return entry.entryType === 'file'
    || canTraceChat(entry)
    || canMove(entry)
    || canRename(entry)
    || canDelete(entry);
}

function hasContextMenuActions(entry: DataCenterUiEntry): boolean {
  return hasMoreMenuActions(entry)
    || canDownload(entry)
    || entry.entryType === 'file';
}

function canTraceChat(entry: DataCenterUiEntry): boolean {
  return entry.entryType === 'file' && !entry.localAuthorized && Boolean(entry.sessionId);
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

export function FeedbackState({ icon, title, description }: { icon: ReactNode; title: string; description?: string }) {
  return (
    <div className="flex h-full min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background text-center">
      <div className="text-muted-foreground">{icon}</div>
      <h2 className="mt-4 text-base font-semibold text-foreground">{title}</h2>
      {description ? (
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
