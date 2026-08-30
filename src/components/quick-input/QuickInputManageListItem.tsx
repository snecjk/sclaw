/**
 * 快捷输入管理列表项：拖拽柄 + 内容 + 编辑/分享/删除。
 * 点击内容区与编辑按钮同为编辑；排序由 @dnd-kit/sortable 驱动，拖拽仅从手柄触发。
 */
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ShareMessageIcon } from '@/components/icons/ShareMessageIcon';
import { cn } from '@/lib/utils';
import type { QuickInputItem } from './types';

interface QuickInputManageListItemProps {
  item: QuickInputItem;
  /** 搜索过滤时禁用拖拽，避免打乱完整列表顺序 */
  sortable?: boolean;
  onEdit: (item: QuickInputItem) => void;
  onShare: (item: QuickInputItem) => void;
  onDelete: (item: QuickInputItem) => void;
}

export function QuickInputManageListItem({
  item,
  sortable = true,
  onEdit,
  onShare,
  onDelete,
}: QuickInputManageListItemProps) {
  const { t } = useTranslation('chat');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !sortable,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        'box-border flex h-10 w-full items-center justify-between self-stretch rounded-lg',
        'border border-[var(--sto-border-default)] bg-[var(--sto-quick-input-row-background)] px-2 py-3',
        'transition-colors hover:bg-[var(--sto-control-picker-hover-background)]',
        isDragging && 'z-10 opacity-50 shadow-sm',
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <button
          type="button"
          className={cn(
            'inline-flex h-4 w-4 shrink-0 items-center justify-center text-[var(--sto-icon-tertiary)]',
            sortable ? 'cursor-grab active:cursor-grabbing touch-none' : 'cursor-not-allowed opacity-40',
          )}
          aria-label={t('composer.quickInputManageDragAria')}
          disabled={!sortable}
          {...(sortable ? { ...attributes, ...listeners } : {})}
        >
          <GripVertical className="h-3.5 w-3.5" aria-hidden />
        </button>

        <button
          type="button"
          onClick={() => onEdit(item)}
          className="min-w-0 flex-1 truncate text-left text-xs font-normal leading-4 text-[var(--sto-quick-input-content-foreground)]"
        >
          {item.content}
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => onEdit(item)}
          className="sto-control sto-control--ghost inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--sto-icon-tertiary)] transition-colors hover:bg-[var(--sto-control-icon-hover-background)] hover:text-[var(--sto-quick-input-icon-hover-foreground)]"
          aria-label={t('composer.quickInputManageEditAria')}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => onShare(item)}
          className="sto-control sto-control--ghost inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--sto-icon-tertiary)] transition-colors hover:bg-[var(--sto-control-icon-hover-background)] hover:text-[var(--sto-quick-input-icon-hover-foreground)]"
          aria-label={t('composer.quickInputManageShareAria')}
        >
          <ShareMessageIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(item)}
          className="sto-control sto-control--ghost inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--sto-icon-tertiary)] transition-colors hover:bg-[var(--sto-control-icon-hover-background)] hover:text-[var(--sto-quick-input-icon-hover-foreground)]"
          aria-label={t('composer.quickInputManageDeleteAria')}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
