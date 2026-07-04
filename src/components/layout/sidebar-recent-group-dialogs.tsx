/**
 * SidebarRecentGroupDialogs — 分组新建/重命名输入弹窗 + 解散二次确认。
 *
 * 使用位置：Sidebar（MainLayout 内），由 Sidebar 持有 open 状态。
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type SidebarRecentGroupDialogMode = 'create' | 'rename' | 'dissolve' | null;

export interface SidebarRecentGroupDialogState {
  mode: SidebarRecentGroupDialogMode;
  /** 新建分组时要加入的 sessionKey */
  sessionKey?: string;
  groupId?: string;
  defaultName?: string;
}

export interface SidebarRecentGroupDialogsProps {
  dialog: SidebarRecentGroupDialogState;
  onClose: () => void;
  onCreateConfirm: (name: string, sessionKey: string) => void | Promise<void>;
  onRenameConfirm: (name: string, groupId: string) => void | Promise<void>;
  onDissolveConfirm: (groupId: string) => void | Promise<void>;
}

export function SidebarRecentGroupDialogs({
  dialog,
  onClose,
  onCreateConfirm,
  onRenameConfirm,
  onDissolveConfirm,
}: SidebarRecentGroupDialogsProps) {
  const { t } = useTranslation('common');
  const [nameDraft, setNameDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (dialog.mode === 'create' || dialog.mode === 'rename') {
      setNameDraft(dialog.defaultName ?? t('sidebar.defaultGroupName'));
    }
  }, [dialog.mode, dialog.defaultName, t]);

  useEffect(() => {
    if (dialog.mode !== null && cancelRef.current) {
      cancelRef.current.focus();
    }
  }, [dialog.mode]);

  if (dialog.mode === null) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !submitting) {
      e.preventDefault();
      onClose();
    }
  };

  const runSubmit = async (action: () => void | Promise<void>) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await action();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  if (dialog.mode === 'dissolve') {
    return createPortal(
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sidebar-dissolve-group-title"
        onKeyDown={handleKeyDown}
      >
        <div className="mx-4 w-full max-w-[360px] overflow-hidden rounded-[18px] bg-card shadow-modal">
          <div className="px-[18px] pb-2 pt-[18px]">
            <h2 id="sidebar-dissolve-group-title" className="text-base font-medium leading-5 text-foreground">
              {t('sidebar.dissolveGroupTitle')}
            </h2>
            <p className="mt-2 text-sm leading-[18px] text-[var(--sto-sidebar-text-icon)]">
              {t('sidebar.dissolveGroupMessage')}
            </p>
          </div>
          <div className="flex justify-end gap-3 px-4 py-4">
            <button
              ref={cancelRef}
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="h-[34px] rounded-xl border border-border bg-card px-4 text-sm font-medium leading-[18px] text-foreground"
            >
              {t('actions.cancel')}
            </button>
            <button
              type="button"
              disabled={submitting || !dialog.groupId}
              onClick={() => {
                if (!dialog.groupId) return;
                void runSubmit(() => onDissolveConfirm(dialog.groupId!));
              }}
              className="inline-flex h-[34px] items-center justify-center rounded-xl bg-destructive px-4 text-sm font-medium leading-[18px] text-white"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                t('sidebar.dissolveGroup')
              )}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  const title =
    dialog.mode === 'create' ? t('sidebar.addToNewGroup') : t('actions.rename');

  const handleConfirm = () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    if (dialog.mode === 'create' && dialog.sessionKey) {
      void runSubmit(() => onCreateConfirm(trimmed, dialog.sessionKey!));
      return;
    }
    if (dialog.mode === 'rename' && dialog.groupId) {
      void runSubmit(() => onRenameConfirm(trimmed, dialog.groupId!));
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sidebar-group-input-title"
      onKeyDown={handleKeyDown}
    >
      <div className="mx-4 w-full max-w-[460px] overflow-hidden rounded-[18px] bg-card shadow-modal">
        <div className="border-b border-border px-3 pb-3 pt-3">
          <div className="flex items-start justify-between gap-3">
            <h2 id="sidebar-group-input-title" className="text-base font-medium leading-5 text-foreground">
              {title}
            </h2>
            <button
              type="button"
              aria-label={t('actions.close')}
              onClick={onClose}
              className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-foreground"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <label className="mt-[18px] block text-xs font-medium leading-[18px] text-foreground">
            {t('sidebar.groupName')}
            <Input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirm();
              }}
              className="mt-1.5 h-[42px] rounded-sm border-border bg-card px-3 py-2 text-xs leading-[18px] shadow-none focus-visible:ring-1"
            />
          </label>
        </div>
        <div className="flex justify-end gap-3 px-4 py-4">
          <button
            ref={cancelRef}
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="h-[34px] rounded-xl border border-border bg-card px-4 text-sm font-medium leading-[18px] text-foreground"
          >
            {t('actions.cancel')}
          </button>
          <button
            type="button"
            disabled={submitting || nameDraft.trim().length === 0}
            onClick={handleConfirm}
            className={cn(
              'inline-flex h-[34px] items-center justify-center rounded-xl px-4 text-sm font-medium leading-[18px] text-white',
              'bg-foreground hover:bg-foreground/90',
            )}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              t('actions.confirm')
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
