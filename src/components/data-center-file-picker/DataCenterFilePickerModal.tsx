/**
 * DataCenterFilePickerModal — 数据中心选文件公用弹窗
 *
 * 设计目标：
 * - 多处复用：Composer 附件、后续 Task / 其他场景共用同一套 UI + 数据逻辑
 * - 调用方只传 `type`：组件内部按类型解析 space、拉列表、搜文件
 * - 确认时内置 download + stage：`onConfirm` 抛出带本地 `stagedPath` 的结果
 * - 样式固化：外观 class 集中在本文件常量，避免各处传入样式造成漂移
 *
 * 内置 API：
 * - `listDataCenterEntries`：树懒加载 / 关键字搜索
 * - `getDataCenterSpaces`：仅 `site_shared_artifact` 打开前解析 spaceId
 * - `getDataCenterDownloadUrl` + `/api/files/stage-buffer`：确认时下载并落本地
 *
 * 用法：
 * ```tsx
 * <DataCenterFilePickerModal
 *   open={open}
 *   type="drive" // | 'qa_artifact' | 'site_shared_artifact'
 *   onClose={() => setOpen(false)}
 *   onConfirm={(files) => {
 *     // files[i].stagedPath 已是本地路径
 *   }}
 * />
 * ```
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, Loader2, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import directoryIcon from '@/assets/icons/directory.svg';
import { FileIcon } from '@/components/attachments/AttachmentChips';
import { IconCheckbox } from '@/components/icon-checkbox';
import { Button } from '@/components/ui/button';
import { getDataCenterSpaces, listDataCenterEntries } from '@/lib/data-center-api';
import { cn } from '@/lib/utils';
import type { DataCenterEntry } from '@/types/data-center';
import { stageDataCenterSelections } from './stage-selection';
import type {
  DataCenterFilePickerType,
  DataCenterPickerSelection,
  DataCenterStagedFile,
} from './types';

const ROOT_ENTRY_ID = 'root';
/** 树缩进：展开子项相对父级的左偏移 */
const TREE_INDENT_PX = 28;

// ---------------------------------------------------------------------------
// 固化样式（勿在调用方覆盖；改外观只改这里）
// ---------------------------------------------------------------------------

const STYLES = {
  /** 遮罩层 */
  overlay: 'fixed inset-0 z-[130] flex items-center justify-center bg-black/45 px-4',
  /** 弹窗壳 */
  panel:
    'flex max-h-[560px] w-[460px] flex-col overflow-hidden rounded-[18px] bg-white p-4 opacity-100 shadow-2xl dark:bg-background',
  /** 顶栏 */
  header: 'flex  items-center justify-between pb-4',
  title:
    "font-['PingFang_SC'] text-[16px] font-medium leading-5 tracking-normal text-[#1D2129] dark:text-foreground",
  closeBtn:
    'flex h-[18px] w-[18px]  items-center justify-center text-[#1A1A1A] hover:opacity-70 dark:text-foreground',
  closeIcon: 'h-[18px] w-[18px]',
  /** 搜索 */
  searchWrap: '',
  searchBox:
    'box-border flex items-center gap-2 rounded-[8px] border border-[#E5E6EB] bg-white p-3 dark:border-border dark:bg-background',
  searchInput:
    'w-full bg-transparent text-[13px] leading-none tracking-normal text-[#1D2129] outline-none placeholder:text-[#86909C] dark:text-foreground',
  searchIcon: 'h-4 w-4  text-[#86909C]',
  /** 列表区（主体） */
  list:
    'flex min-h-0 flex-1 flex-col justify-center self-stretch overflow-y-auto bg-white p-2 dark:bg-background',
  rowBase:
    'flex h-12 w-full min-w-0 items-center gap-1.5 overflow-hidden text-left',
  rowText: 'min-w-0 flex-1 truncate text-[14px] font-medium leading-[18px] text-[#1D2129]',
  fileText:
    'min-w-0 flex-1 truncate text-[12px] font-semibold leading-[18px] tracking-normal text-[#1D2129] [font-variation-settings:"opsz"_auto]',
  rowIcon: 'h-[30px] w-[30px] shrink-0 object-contain',
  chevron: 'h-[18px] w-[18px] shrink-0 text-black',
  fileSize: 'shrink-0 text-[11px] text-[#86909C]',
  muted: 'py-3 text-[12px] text-[#86909C]',
  mutedInline: 'flex items-center gap-2 py-3 text-[12px] text-[#86909C]',
  /** 底栏 */
  footer: 'flex shrink-0 items-center justify-end',
  cancelBtn: 'rounded-[12px] text-[12px] font-normal',
  confirmBtn:
    'rounded-[12px] bg-[#1D2129] text-[12px] font-normal text-white hover:bg-[#4E5969] dark:bg-primary dark:text-primary-foreground',
} as const;

// ---------------------------------------------------------------------------
// 类型文案 / space 解析（内置，调用方不传）
// ---------------------------------------------------------------------------

const TITLE_I18N_KEY: Record<DataCenterFilePickerType, string> = {
  drive: 'composer.attachDriveTitle',
  qa_artifact: 'composer.attachQaArtifactTitle',
  site_shared_artifact: 'composer.attachSiteSharedTitle',
};

function isSiteSharedArtifactSpace(space: {
  spaceType?: string;
  scopeType?: string | null;
  displayName?: string;
}): boolean {
  return space.spaceType === 'site_shared_artifact'
    || space.scopeType === 'site'
    || space.displayName?.includes('网点共享产物') === true;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface DataCenterFilePickerModalProps {
  open: boolean;
  /**
   * 数据源类型（唯一业务入参）：
   * - `drive` 在线文件
   * - `qa_artifact` 我的产物
   * - `site_shared_artifact` 网点共享产物（内部自动拉 spaces 拿 spaceId）
   */
  type: DataCenterFilePickerType;
  onClose: () => void;
  /** 确认成功后回传：已下载并 stage 到本地的文件（含 stagedPath） */
  onConfirm: (files: DataCenterStagedFile[]) => void;
}

type ChildrenMap = Record<string, DataCenterEntry[]>;
type BoolMap = Record<string, boolean>;

export function DataCenterFilePickerModal({
  open,
  type,
  onClose,
  onConfirm,
}: DataCenterFilePickerModalProps) {
  const { t } = useTranslation('chat');

  // 解析后的 spaceId：drive / qa_artifact 为 null；网点共享在打开时由 getDataCenterSpaces 填入
  const [resolvedSpaceId, setResolvedSpaceId] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [childrenMap, setChildrenMap] = useState<ChildrenMap>({});
  const [loadingMap, setLoadingMap] = useState<BoolMap>({});
  const [openMap, setOpenMap] = useState<BoolMap>({ [ROOT_ENTRY_ID]: true });
  const [selected, setSelected] = useState<Record<string, DataCenterPickerSelection>>({});
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<DataCenterEntry[]>([]);
  /** 确认中：正在 download + stage，禁用关闭/重复点击 */
  const [confirming, setConfirming] = useState(false);

  const title = t(TITLE_I18N_KEY[type]);
  const confirmLabel = t('composer.attachConfirm');
  const cancelLabel = t('composer.attachCancel');
  const searchPlaceholder = t('composer.attachSearchPlaceholder');
  const emptyLabel = t('composer.attachEmpty');
  const loadingLabel = t('composer.attachLoading');

  /** 打开时重置 UI，并按 type 解析 space（网点共享走 getDataCenterSpaces）。 */
  useEffect(() => {
    if (!open) return;

    setKeyword('');
    setDebouncedKeyword('');
    setChildrenMap({});
    setLoadingMap({});
    setOpenMap({ [ROOT_ENTRY_ID]: true });
    setSelected({});
    setSearchResults([]);
    setBootstrapError(null);
    setResolvedSpaceId(null);
    setConfirming(false);

    if (type !== 'site_shared_artifact') {
      setBootstrapping(false);
      return;
    }

    let cancelled = false;
    setBootstrapping(true);
    void getDataCenterSpaces()
      .then((result) => {
        if (cancelled) return;
        const shared = (result.spaces ?? []).find(isSiteSharedArtifactSpace);
        const spaceId = shared?.spaceId ?? null;
        if (!spaceId) {
          const message = '未找到网点共享产物空间';
          setBootstrapError(message);
          toast.error(message);
          onClose();
          return;
        }
        setResolvedSpaceId(spaceId);
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : '加载网点共享空间失败';
        setBootstrapError(message);
        toast.error(message);
        onClose();
      })
      .finally(() => {
        if (!cancelled) setBootstrapping(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, type, onClose]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setDebouncedKeyword(keyword.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [keyword, open]);

  /** 树节点懒加载：listDataCenterEntries(parent) */
  const loadChildren = useCallback(async (parentEntryId: string) => {
    if (type === 'site_shared_artifact' && !resolvedSpaceId) return;

    setLoadingMap((prev) => ({ ...prev, [parentEntryId]: true }));
    try {
      const result = await listDataCenterEntries({
        spaceType: type,
        spaceId: resolvedSpaceId ?? undefined,
        parentEntryId,
        pageSize: 200,
        sortField: 'name',
        sortOrder: 'asc',
      });
      const items = result.items ?? [];
      console.log('[DataCenterFilePicker] loadChildren', {
        parentEntryId,
        type,
        spaceId: resolvedSpaceId,
        count: items.length,
        items,
      });
      setChildrenMap((prev) => ({ ...prev, [parentEntryId]: items }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载文件列表失败');
      setChildrenMap((prev) => ({ ...prev, [parentEntryId]: [] }));
    } finally {
      setLoadingMap((prev) => ({ ...prev, [parentEntryId]: false }));
    }
  }, [type, resolvedSpaceId]);

  useEffect(() => {
    if (!open || bootstrapping || bootstrapError) return;
    if (type === 'site_shared_artifact' && !resolvedSpaceId) return;
    if (debouncedKeyword) return;
    void loadChildren(ROOT_ENTRY_ID);
  }, [open, bootstrapping, bootstrapError, debouncedKeyword, loadChildren, type, resolvedSpaceId]);

  /** 关键字搜索：listDataCenterEntries(keyword, entryType=file) */
  useEffect(() => {
    if (!open || !debouncedKeyword || bootstrapping) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    if (type === 'site_shared_artifact' && !resolvedSpaceId) return;

    let cancelled = false;
    setSearching(true);
    void listDataCenterEntries({
      spaceType: type,
      spaceId: resolvedSpaceId ?? undefined,
      parentEntryId: ROOT_ENTRY_ID,
      keyword: debouncedKeyword,
      entryType: 'file',
      pageSize: 100,
      sortField: 'name',
      sortOrder: 'asc',
    })
      .then((result) => {
        if (cancelled) return;
        const items = (result.items ?? []).filter((item) => item.entryType === 'file');
        console.log('[DataCenterFilePicker] searchResults', {
          keyword: debouncedKeyword,
          type,
          spaceId: resolvedSpaceId,
          count: items.length,
          items,
        });
        setSearchResults(items);
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(error instanceof Error ? error.message : '搜索失败');
        setSearchResults([]);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, debouncedKeyword, type, resolvedSpaceId, bootstrapping]);

  const selectedList = useMemo(() => Object.values(selected), [selected]);
  const selectedCount = selectedList.length;

  /** 确认：组件内 download + stage，成功后把本地路径抛给调用方 */
  const handleConfirm = useCallback(async () => {
    if (selectedList.length === 0 || confirming || bootstrapping) return;
    setConfirming(true);
    try {
      const { staged, errors } = await stageDataCenterSelections(selectedList);
      if (errors.length > 0) {
        const names = errors.map((item) => item.name).join('、');
        toast.error(staged.length > 0
          ? `部分文件添加失败：${names}`
          : `添加失败：${names}`);
      }
      if (staged.length === 0) return;
      onConfirm(staged);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '添加数据中心文件失败');
    } finally {
      setConfirming(false);
    }
  }, [selectedList, confirming, bootstrapping, onConfirm]);

  const requestClose = useCallback(() => {
    if (confirming) return;
    onClose();
  }, [confirming, onClose]);

  useEffect(() => {
    if (!open) return;
    if (debouncedKeyword) {
      console.log('[DataCenterFilePicker] render list (search)', {
        keyword: debouncedKeyword,
        searching,
        count: searchResults.length,
        items: searchResults,
      });
      return;
    }
    console.log('[DataCenterFilePicker] render list (tree)', {
      openMap,
      childrenMap,
      rootCount: childrenMap[ROOT_ENTRY_ID]?.length ?? 0,
      rootItems: childrenMap[ROOT_ENTRY_ID] ?? [],
    });
  }, [open, debouncedKeyword, searching, searchResults, childrenMap, openMap]);

  const toggleFile = (entry: DataCenterEntry) => {
    if (entry.entryType !== 'file') return;
    setSelected((prev) => {
      if (prev[entry.entryId]) {
        const next = { ...prev };
        delete next[entry.entryId];
        return next;
      }
      return {
        ...prev,
        [entry.entryId]: {
          entryId: entry.entryId,
          name: entry.name,
          mimeType: entry.mimeType,
          fileSize: entry.fileSize,
          spaceType: (entry.spaceType as DataCenterFilePickerType) || type,
          spaceId: entry.spaceId ?? resolvedSpaceId,
        },
      };
    });
  };

  const toggleFolder = (folderId: string) => {
    setOpenMap((prev) => {
      const nextOpen = !prev[folderId];
      if (nextOpen && !childrenMap[folderId] && !loadingMap[folderId]) {
        void loadChildren(folderId);
      }
      return { ...prev, [folderId]: nextOpen };
    });
  };

  if (!open || typeof document === 'undefined') return null;

  const renderTreeRows = (parentId: string, depth: number): ReactNode => {
    const items = childrenMap[parentId] ?? [];
    const loading = loadingMap[parentId];
    if (loading && items.length === 0) {
      return (
        <div className={STYLES.mutedInline}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {loadingLabel}
        </div>
      );
    }
    if (!loading && items.length === 0) {
      return <div className={STYLES.muted}>{emptyLabel}</div>;
    }

    return items.map((entry) => {
      if (entry.entryType === 'folder') {
        const isOpen = Boolean(openMap[entry.entryId]);
        return (
          <div key={entry.entryId}>
            <div style={{ paddingLeft: depth * TREE_INDENT_PX }}>
              <button
                type="button"
                className={STYLES.rowBase}
                onClick={() => toggleFolder(entry.entryId)}
              >
                {isOpen ? (
                  <ChevronDown className={STYLES.chevron} />
                ) : (
                  <ChevronRight className={STYLES.chevron} />
                )}
                <img src={directoryIcon} alt="" className={STYLES.rowIcon} draggable={false} />
                <span className={STYLES.rowText}>{entry.name}</span>
              </button>
            </div>
            {isOpen ? renderTreeRows(entry.entryId, depth + 1) : null}
          </div>
        );
      }

      const checked = Boolean(selected[entry.entryId]);
      return (
        <div
          key={entry.entryId}
          role="button"
          tabIndex={0}
          className={cn(STYLES.rowBase, 'cursor-pointer')}
          style={{ paddingLeft: depth * TREE_INDENT_PX }}
          onClick={() => toggleFile(entry)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              toggleFile(entry);
            }
          }}
        >
          <IconCheckbox checked={checked} />
          <FileIcon
            fileName={entry.name}
            mimeType={entry.mimeType || undefined}
            className={STYLES.rowIcon}
          />
          <span className={STYLES.fileText} title={entry.name}>{entry.name}</span>
          {entry.fileSize > 0 ? (
            <span className={STYLES.fileSize}>{formatBytes(entry.fileSize)}</span>
          ) : null}
        </div>
      );
    });
  };

  const listBody = (() => {
    if (bootstrapping) {
      return (
        <div className={STYLES.mutedInline}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {loadingLabel}
        </div>
      );
    }
    if (debouncedKeyword) {
      if (searching) {
        return (
          <div className={STYLES.mutedInline}>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {loadingLabel}
          </div>
        );
      }
      if (searchResults.length === 0) {
        return <div className={STYLES.muted}>{emptyLabel}</div>;
      }
      return searchResults.map((entry) => {
        const checked = Boolean(selected[entry.entryId]);
        return (
          <div
            key={entry.entryId}
            role="button"
            tabIndex={0}
            className={cn(STYLES.rowBase, 'cursor-pointer')}
            onClick={() => toggleFile(entry)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleFile(entry);
              }
            }}
          >
            <IconCheckbox checked={checked} />
            <FileIcon
              fileName={entry.name}
              mimeType={entry.mimeType || undefined}
              className={STYLES.rowIcon}
            />
            <span className={STYLES.fileText} title={entry.name}>{entry.name}</span>
            {entry.fileSize > 0 ? (
              <span className={STYLES.fileSize}>{formatBytes(entry.fileSize)}</span>
            ) : null}
          </div>
        );
      });
    }
    return renderTreeRows(ROOT_ENTRY_ID, 0);
  })();

  return createPortal(
    <div
      className={STYLES.overlay}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        className={STYLES.panel}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={STYLES.header}>
          <h2 className={STYLES.title}>{title}</h2>
          <button
            type="button"
            onClick={requestClose}
            className={STYLES.closeBtn}
            aria-label="关闭"
            disabled={confirming}
          >
            <X className={STYLES.closeIcon} strokeWidth={2} />
          </button>
        </div>

        <div className={STYLES.searchWrap}>
          <div className={STYLES.searchBox}>
            <Search className={STYLES.searchIcon} />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={searchPlaceholder}
              className={STYLES.searchInput}
              disabled={bootstrapping || confirming}
            />
          </div>
        </div>

        <div className={STYLES.list}>{listBody}</div>

        <div className={STYLES.footer}>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className={STYLES.cancelBtn}
              onClick={requestClose}
              disabled={confirming}
            >
              {cancelLabel}
            </Button>
            <Button
              type="button"
              className={STYLES.confirmBtn}
              disabled={selectedCount === 0 || bootstrapping || confirming}
              onClick={() => { void handleConfirm(); }}
            >
              {confirming ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  {loadingLabel}
                </>
              ) : confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
