/**
 * 快捷输入管理弹窗：搜索 + 可排序列表（编辑/分享/删除）+ 取消/保存。
 * 容器与底部按钮样式对齐 QuickInputCreateModal；搜索框对齐 QuickInputPicker。
 * 列表排序使用 @dnd-kit/sortable。删除即时写 store；保存提交槽位重排。
 * 拖拽草稿序留在本地，点保存后再写回 store。
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArtifactShareDialog } from '@/components/file-preview/ArtifactShareDialog';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  buildConversationShareDialogDraft,
  type DingTalkShareDialogDraft,
} from '@/lib/dingtalk-share';
import { QuickInputCreateModal } from './QuickInputCreateModal';
import { QuickInputManageListItem } from './QuickInputManageListItem';
import { useQuickInputStore } from './store';
import { QUICK_INPUT_LIST_CAP, type QuickInputItem } from './types';

/** 锁定左右位移，仅允许上下拖动 */
const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

interface QuickInputManageModalProps {
  open: boolean;
  onClose: () => void;
}

export function QuickInputManageModal({ open, onClose }: QuickInputManageModalProps) {
  return (
    <AnimatePresence>
      {open ? (
        <QuickInputManageModalInner key="quick-input-manage" onClose={onClose} />
      ) : null}
    </AnimatePresence>
  );
}

function QuickInputManageModalInner({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('chat');
  const storeTotal = useQuickInputStore((s) => s.total);
  const storeLoading = useQuickInputStore((s) => s.loading);
  const fetchList = useQuickInputStore((s) => s.fetchList);
  const updateItem = useQuickInputStore((s) => s.update);
  const removeItem = useQuickInputStore((s) => s.remove);
  const reorderItems = useQuickInputStore((s) => s.reorder);

  /** 拖拽草稿：与 store 分离，保存时再写回；仅打开时灌入一次，避免冲掉本地改序 */
  const [draftItems, setDraftItems] = useState<QuickInputItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [editingItem, setEditingItem] = useState<QuickInputItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QuickInputItem | null>(null);
  const [shareDraft, setShareDraft] = useState<DingTalkShareDialogDraft | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await fetchList();
        if (cancelled) return;
        setDraftItems(useQuickInputStore.getState().items);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('composer.quickInputLoadFailed');
        toast.error(message);
        setDraftItems([]);
      } finally {
        if (!cancelled) setInitialized(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchList, t]);

  const capped = storeTotal > QUICK_INPUT_LIST_CAP;
  const loading = !initialized || (storeLoading && draftItems.length === 0);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' &&
        !editingItem &&
        !deleteTarget &&
        !shareDialogOpen &&
        !saving
      ) {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, editingItem, deleteTarget, shareDialogOpen, saving]);

  const trimmedQuery = query.trim().toLowerCase();
  const isFiltering = trimmedQuery.length > 0;

  const filtered = useMemo(() => {
    if (!isFiltering) return draftItems;
    return draftItems.filter(
      (item) =>
        item.title.toLowerCase().includes(trimmedQuery) ||
        item.content.toLowerCase().includes(trimmedQuery),
    );
  }, [draftItems, isFiltering, trimmedQuery]);

  const handleDragEnd = (event: DragEndEvent) => {
    if (isFiltering) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setDraftItems((prev) => {
      const oldIndex = prev.findIndex((item) => item.id === active.id);
      const newIndex = prev.findIndex((item) => item.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (draftItems.length > 0) {
        await reorderItems(draftItems.map((item) => item.id));
      }
      toast.success(t('composer.quickInputSaveSuccess'));
      onClose();
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : t('composer.quickInputSaveFailed');
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleShare = (item: QuickInputItem) => {
    setShareDraft(buildConversationShareDialogDraft(item.content, []));
    setShareDialogOpen(true);
  };

  const closeShareDialog = () => {
    setShareDialogOpen(false);
    setShareDraft(null);
  };

  return createPortal(
    <>
      <motion.div
        className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
        onClick={() => {
          if (!saving && !shareDialogOpen) onClose();
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2, ease: 'easeInOut' }}
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="quick-input-manage-title"
          className="flex h-[496px] w-[640px] flex-col overflow-hidden rounded-[18px] bg-white p-0 dark:bg-background"
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          <div className="flex h-[52px] w-full shrink-0 items-center justify-between bg-white p-4 dark:bg-background">
            <h2
              id="quick-input-manage-title"
              className="text-base font-semibold leading-6 text-[#1D2129] dark:text-foreground"
            >
              {t('composer.quickInputManageModalTitle')}
            </h2>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#86909C] transition-colors hover:bg-[#F2F3F5] hover:text-[#1D2129] disabled:opacity-50 dark:hover:bg-muted dark:hover:text-foreground"
              aria-label={t('composer.quickInputCreateCloseAria')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2 self-stretch px-4 py-2">
            <div className="box-border flex h-[34px] w-full shrink-0 items-center gap-2 rounded-lg border border-[#E8EAEF] bg-white p-2 dark:border-border dark:bg-background">
              <Search className="h-3.5 w-3.5 shrink-0 text-[#86909C]" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('composer.quickInputManageSearchPlaceholder')}
                className="min-w-0 flex-1 bg-transparent text-xs text-[#1D2129] outline-none placeholder:text-[#86909C] dark:text-foreground"
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {loading ? (
                <div className="flex items-center justify-center gap-2 px-3 py-10 text-xs text-[#86909C]">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {t('composer.quickInputLoading')}
                </div>
              ) : filtered.length === 0 ? (
                <div className="px-3 py-10 text-center text-xs text-[#86909C]">
                  {t('composer.quickInputNoResults')}
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  modifiers={[restrictToVerticalAxis]}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={filtered.map((item) => item.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="flex flex-col gap-2">
                      {filtered.map((item) => (
                        <QuickInputManageListItem
                          key={item.id}
                          item={item}
                          sortable={!isFiltering}
                          onEdit={setEditingItem}
                          onShare={handleShare}
                          onDelete={setDeleteTarget}
                        />
                      ))}
                      {capped ? (
                        <p className="mt-1 px-2 py-2 text-center text-[12px] text-[#86909C] dark:text-muted-foreground">
                          {t('composer.quickInputCappedHint')}
                        </p>
                      ) : null}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </div>
          </div>

          <div className="flex h-16 w-full items-center justify-end gap-4 bg-white p-4 dark:bg-background">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={saving}
              className="box-border flex h-[34px] w-[60px] flex-col items-center justify-center rounded-xl border border-[#E5E6EB] bg-white px-4 py-2 text-sm font-medium text-[#1D2129] hover:bg-white dark:border-border dark:bg-background dark:text-foreground"
            >
              {t('composer.quickInputCreateCancel')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || loading}
              className="box-border flex h-[34px] min-w-[60px] flex-col items-center justify-center rounded-xl border-none bg-[#1D2129] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D2129]/90 dark:bg-foreground dark:text-background"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                t('composer.quickInputManageSave')
              )}
            </Button>
          </div>
        </motion.div>
      </motion.div>

      <QuickInputCreateModal
        open={Boolean(editingItem)}
        id={editingItem?.id}
        initialContent={editingItem?.content}
        onClose={() => setEditingItem(null)}
        onConfirm={async (content) => {
          if (!editingItem) return;
          const updated = await updateItem(editingItem.id, content);
          setDraftItems((prev) =>
            prev.map((entry) => (entry.id === updated.id ? updated : entry)),
          );
          toast.success(t('composer.quickInputUpdateSuccess'));
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t('composer.quickInputDeleteConfirmTitle')}
        message={t('composer.quickInputDeleteConfirmMessage')}
        confirmLabel={t('composer.quickInputDeleteConfirm')}
        confirmingLabel={t('composer.quickInputDeleting')}
        cancelLabel={t('composer.quickInputCreateCancel')}
        variant="destructive"
        overlayClassName="z-[10060]"
        onConfirm={async () => {
          if (!deleteTarget) return;
          const id = deleteTarget.id;
          await removeItem(id);
          setDeleteTarget(null);
          setDraftItems((prev) => prev.filter((entry) => entry.id !== id));
          toast.success(t('composer.quickInputDeleteSuccess'));
        }}
        onCancel={() => setDeleteTarget(null)}
        onError={(err) => {
          const message =
            err instanceof Error && err.message
              ? err.message
              : t('composer.quickInputSaveFailed');
          toast.error(message);
        }}
      />

      <ArtifactShareDialog
        open={shareDialogOpen}
        draft={shareDraft}
        title={t('preview.shareDialog.title')}
        description={t('preview.shareDialog.description')}
        overlayClassName="z-[10070]"
        onShared={() => {
          toast.success(t('preview.shareDialog.success'));
          closeShareDialog();
        }}
        onCancel={closeShareDialog}
        onError={(error) => {
          toast.error(
            error instanceof Error ? error.message : t('preview.shareDialog.failed'),
          );
        }}
      />
    </>,
    document.body,
  );
}
