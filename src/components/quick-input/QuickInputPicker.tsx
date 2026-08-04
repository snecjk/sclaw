/**
 * 快捷输入选择浮层：对齐 WorkflowPicker（portal + fixed）。
 * 有数据：搜索 + 列表（可滚动）+ 新建；无数据：空态。
 * 列表数据来自 useQuickInputStore。
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { QuickInputManageIcon } from '@/components/icons/QuickInputManageIcon';
import { PlusIcon } from '@/components/icons/PlusIcon';
import quickInputEmptyIcon from '@/assets/icons/quick-input-empty.png';
import { QuickInputCreateModal } from './QuickInputCreateModal';
import { QuickInputManageModal } from './QuickInputManageModal';
import { QuickInputListItem } from './QuickInputListItem';
import { useQuickInputStore } from './store';
import { QUICK_INPUT_LIST_CAP, type QuickInputItem } from './types';

export type { QuickInputItem };

interface QuickInputPickerProps {
  open: boolean;
  onClose: () => void;
  /** 新建成功后的额外回调（可选） */
  onCreate?: (item: QuickInputItem) => void;
  onSelect?: (item: QuickInputItem) => void;
  onManage?: () => void;
  /** 锚定按钮：有则 portal + fixed 定位，避免被输入壳 overflow 裁切 */
  anchorRef?: RefObject<HTMLElement | null>;
  className?: string;
}

type PickerPosition = {
  left: number;
  bottom: number;
  width: number;
};

export const QuickInputPicker = forwardRef<HTMLDivElement, QuickInputPickerProps>(
  ({ open, onClose, onCreate, onSelect, onManage, anchorRef, className }, ref) => {
    const { t } = useTranslation('chat');
    const [position, setPosition] = useState<PickerPosition | null>(null);
    const [query, setQuery] = useState('');
    const [createModalOpen, setCreateModalOpen] = useState(false);
    const [manageModalOpen, setManageModalOpen] = useState(false);
    const localRef = useRef<HTMLDivElement | null>(null);

    const items = useQuickInputStore((s) => s.items);
    const total = useQuickInputStore((s) => s.total);
    const loading = useQuickInputStore((s) => s.loading);
    const fetchList = useQuickInputStore((s) => s.fetchList);
    const create = useQuickInputStore((s) => s.create);

    const refreshList = useCallback(async () => {
      try {
        await fetchList();
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('composer.quickInputLoadFailed');
        toast.error(message);
      }
    }, [fetchList, t]);

    useEffect(() => {
      if (!open) {
        const timer = setTimeout(() => setQuery(''), 0);
        return () => clearTimeout(timer);
      }
      void refreshList();
      return undefined;
    }, [open, refreshList]);

    useLayoutEffect(() => {
      if (!open || !anchorRef?.current) {
        setPosition(null);
        return;
      }

      const updatePosition = () => {
        const rect = anchorRef.current?.getBoundingClientRect();
        if (!rect) return;
        const width = Math.min(280, window.innerWidth - 24);
        const left = Math.min(
          Math.max(12, rect.left),
          window.innerWidth - width - 12,
        );
        setPosition({
          left,
          bottom: window.innerHeight - rect.top + 8,
          width,
        });
      };

      updatePosition();
      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, true);
      return () => {
        window.removeEventListener('resize', updatePosition);
        window.removeEventListener('scroll', updatePosition, true);
      };
    }, [open, anchorRef]);

    const capped = total > QUICK_INPUT_LIST_CAP || items.length > QUICK_INPUT_LIST_CAP;
    const visibleSource = useMemo(
      () => (items.length > QUICK_INPUT_LIST_CAP ? items.slice(0, QUICK_INPUT_LIST_CAP) : items),
      [items],
    );

    const filtered = useMemo(() => {
      const trimmed = query.trim().toLowerCase();
      if (!trimmed) return visibleSource;
      return visibleSource.filter(
        (item) =>
          item.title.toLowerCase().includes(trimmed) ||
          item.content.toLowerCase().includes(trimmed),
      );
    }, [query, visibleSource]);

    const setRefs = (node: HTMLDivElement | null) => {
      localRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    };

    const hasData = items.length > 0;

    const handleSelect = (item: QuickInputItem) => {
      onSelect?.(item);
      onClose();
    };

    const handleOpenCreate = () => {
      onClose();
      setCreateModalOpen(true);
    };

    const handleOpenManage = () => {
      onClose();
      onManage?.();
      setManageModalOpen(true);
    };

    const modals = (
      <>
        <QuickInputCreateModal
          open={createModalOpen}
          onClose={() => setCreateModalOpen(false)}
          onConfirm={async (content) => {
            const created = await create(content);
            toast.success(t('composer.quickInputCreateSuccess'));
            onCreate?.(created);
          }}
        />
        <QuickInputManageModal
          open={manageModalOpen}
          onClose={() => setManageModalOpen(false)}
        />
      </>
    );

    if (!open) {
      return modals;
    }

    const panel = (
      <div
        ref={setRefs}
        className={cn(
          'box-border z-50 flex flex-col justify-center gap-1 overflow-hidden rounded-xl',
          'border border-[#E5E6EB] bg-white p-2 shadow-[0_4px_12px_rgba(0,0,0,0.1)]',
          'dark:border-border dark:bg-secondary dark:shadow-soft',
          position ? 'fixed' : 'absolute left-0 bottom-full mb-2 w-[280px]',
          className,
        )}
        style={
          position
            ? {
                left: position.left,
                bottom: position.bottom,
                width: position.width,
              }
            : undefined
        }
      >
        {hasData ? (
          <div className="flex h-[34px] w-full shrink-0 items-center gap-2 self-stretch p-0">
            <div className="box-border flex h-[34px] min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#E8EAEF] bg-white p-2 dark:border-border dark:bg-background">
              <Search className="h-3.5 w-3.5 shrink-0 text-[#86909C]" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('composer.quickInputSearchPlaceholder')}
                className="min-w-0 flex-1 bg-transparent text-xs text-[#1D2129] outline-none placeholder:text-[#86909C] dark:text-foreground"
              />
            </div>
            <button
              type="button"
              onClick={handleOpenManage}
              className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[#4E5969] transition-colors hover:text-[#1D2129] dark:text-muted-foreground dark:hover:text-foreground"
            >
              <QuickInputManageIcon />
              <span className="inline-flex h-4 w-6 items-center text-xs font-medium leading-4 text-[#4E5969]">
                {t('composer.quickInputManage')}
              </span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col justify-center gap-1.5 self-stretch px-2 py-1 text-xs font-medium leading-4 text-[#86909C] dark:text-muted-foreground">
            {t('composer.quickInputTitle')}
          </div>
        )}

        {loading && !hasData ? (
          <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 px-2 py-6">
            <p className="text-center text-xs text-[#86909C]">{t('composer.quickInputLoading')}</p>
          </div>
        ) : hasData ? (
          <div className="h-[200px] overflow-y-auto overscroll-contain py-0.5">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-[#86909C]">
                {t('composer.quickInputNoResults')}
              </div>
            ) : (
              <>
                {filtered.map((item) => (
                  <QuickInputListItem key={item.id} item={item} onSelect={handleSelect} />
                ))}
                {capped ? (
                  <p className="mt-1 px-2 py-2 text-center text-[12px] text-[#86909C] dark:text-muted-foreground">
                    {t('composer.quickInputCappedHint')}
                  </p>
                ) : null}
              </>
            )}
          </div>
        ) : (
          <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 px-2 py-6">
            <img src={quickInputEmptyIcon} alt="" width={40} height={40} aria-hidden />
            <p className="flex h-4 w-[120px] items-center justify-center text-center text-xs font-normal leading-4 text-[#86909C]">
              {t('composer.quickInputEmpty')}
            </p>
          </div>
        )}

        <div className="px-1 pt-1">
          <button
            type="button"
            onClick={handleOpenCreate}
            className={cn(
              'flex h-9 w-full items-center justify-center gap-1 rounded-xl border border-[#E5E6EB]',
              'text-[12px] font-medium text-[#1D2129] transition-colors',
              'hover:bg-[#F7F8FA] dark:border-border dark:text-foreground dark:hover:bg-muted',
            )}
          >
            <PlusIcon />
            {t('composer.quickInputCreate')}
          </button>
        </div>
      </div>
    );

    return (
      <>
        {anchorRef ? createPortal(panel, document.body) : panel}
        {modals}
      </>
    );
  },
);

QuickInputPicker.displayName = 'QuickInputPicker';
