/**
 * SidebarRecentGroupDialogs — 分组新建输入弹窗 + 解散二次确认。
 *
 * 新建样式对齐「我的任务」TaskCreateModal（bg-black/40、rounded-[22px]、底栏主钮等）。
 * 解散仍用 ConfirmDialog（与同页删除确认一致）；分组重命名走 SidebarRecentGroupRow inline 编辑。
 * 使用位置：Sidebar（MainLayout 内），由 Sidebar 持有 open 状态。
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formFieldFocusClass, modalPrimarySubmitButtonClass } from '@/lib/surfaces';

export type SidebarRecentGroupDialogMode = 'create' | 'dissolve' | null;

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
  onDissolveConfirm: (groupId: string) => void | Promise<void>;
}

function SidebarRecentGroupDialogsContent({
  dialog,
  onClose,
  onCreateConfirm,
  onDissolveConfirm,
}: SidebarRecentGroupDialogsProps) {
  const { t } = useTranslation('common');
  const [nameDraft, setNameDraft] = useState(
    () => dialog.defaultName ?? t('sidebar.defaultGroupName'),
  );
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (dialog.mode === 'create' && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [dialog.mode, dialog.defaultName]);

  const handleDissolveConfirm = async () => {
    if (!dialog.groupId) return;
    await onDissolveConfirm(dialog.groupId);
    onClose();
  };

  if (dialog.mode === 'dissolve') {
    return (
      <ConfirmDialog
        open
        title={t('sidebar.dissolveGroupTitle')}
        message={t('sidebar.dissolveGroupMessage')}
        confirmLabel={t('sidebar.dissolveGroup')}
        cancelLabel={t('actions.cancel')}
        variant="destructive"
        onConfirm={() => void handleDissolveConfirm()}
        onCancel={onClose}
      />
    );
  }

  if (dialog.mode !== 'create') {
    return null;
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !submitting) {
      e.preventDefault();
      onClose();
    }
  };

  const handleConfirm = async () => {
    if (submitting) return;
    const trimmed = nameDraft.trim();
    if (!trimmed) return;

    setSubmitting(true);
    try {
      if (dialog.sessionKey) {
        await onCreateConfirm(trimmed, dialog.sessionKey);
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="sto-overlay-scrim sto-overlay-scrim--dialog fixed inset-0 z-50 flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sidebar-group-input-title"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="sto-overlay sto-overlay--dialog flex w-full max-w-[min(480px,100%)] flex-col rounded-[var(--sto-dialog-radius)] border"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <div className="mb-6 flex flex-shrink-0 items-start justify-between gap-4 px-[18px] pt-[18px]">
          <h2
            id="sidebar-group-input-title"
            className="text-xl font-bold leading-[1.3] tracking-[-0.02em] text-foreground"
          >
            {t('sidebar.addToNewGroup')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="-mr-2 -mt-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t('actions.close')}
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="flex flex-col gap-2 px-[18px] pb-4">
          <label htmlFor="sidebar-group-name-input" className="block text-sm font-semibold text-foreground">
            {t('sidebar.groupName')}
          </label>
          <input
            ref={inputRef}
            id="sidebar-group-name-input"
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleConfirm();
              }
            }}
            disabled={submitting}
            autoComplete="off"
            className={cn(
              'h-[42px] w-full rounded-[10px] border border-border bg-background px-3.5 text-sm transition-colors placeholder:text-muted-foreground',
              formFieldFocusClass,
            )}
          />
        </div>

        <div className="sto-dialog-footer flex-shrink-0 rounded-b-[22px] px-[18px] pb-[18px] pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={submitting}
            className="h-[42px] rounded-[10px] px-5 text-sm"
          >
            {t('actions.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={submitting || nameDraft.trim().length === 0}
            className={modalPrimarySubmitButtonClass}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                {t('actions.confirm')}
              </>
            ) : (
              t('actions.confirm')
            )}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function SidebarRecentGroupDialogs(props: SidebarRecentGroupDialogsProps) {
  const { dialog } = props;
  if (!dialog.mode) return null;
  const resetKey = dialog.mode === 'create'
    ? `create:${dialog.sessionKey ?? ''}:${dialog.defaultName ?? ''}`
    : `dissolve:${dialog.groupId ?? ''}`;
  return <SidebarRecentGroupDialogsContent key={resetKey} {...props} />;
}
