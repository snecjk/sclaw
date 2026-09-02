/**
 * 新建/编辑快捷输入弹窗：标题 + 输入内容 + AI 美化 + 取消/确认。
 * 传入业务 id 为编辑，否则为新建。
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AiBeautifyButton } from '@/components/ai-beautify/AiBeautifyButton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface QuickInputCreateModalProps {
  open: boolean;
  onClose: () => void;
  /** 可返回 Promise；成功后再关闭弹窗 */
  onConfirm: (content: string) => void | Promise<void>;
  /** 业务 id：有值则为编辑，否则为新建 */
  id?: string;
  /** 编辑时预填内容 */
  initialContent?: string;
}

export function QuickInputCreateModal({
  open,
  onClose,
  onConfirm,
  id,
  initialContent,
}: QuickInputCreateModalProps) {
  const isEditing = Boolean(id);
  return (
    <AnimatePresence>
      {open ? (
        <QuickInputCreateModalInner
          key={id ? `quick-input-edit:${id}` : 'quick-input-create'}
          id={id}
          isEditing={isEditing}
          initialContent={initialContent}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      ) : null}
    </AnimatePresence>
  );
}

function QuickInputCreateModalInner({
  id,
  isEditing,
  initialContent,
  onClose,
  onConfirm,
}: {
  id?: string;
  isEditing: boolean;
  initialContent?: string;
  onClose: () => void;
  onConfirm: (content: string) => void | Promise<void>;
}) {
  const { t } = useTranslation('chat');
  const [content, setContent] = useState(initialContent ?? '');
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, submitting]);

  const handleConfirm = async () => {
    const trimmed = content.trim();
    if (!trimmed) {
      setError(t('composer.quickInputCreateContentRequired'));
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      await onConfirm(trimmed);
      onClose();
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : t('composer.quickInputSaveFailed');
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <motion.div
      className="sto-overlay-scrim sto-overlay-scrim--dialog fixed inset-0 z-[10050] flex items-center justify-center px-4"
      onClick={() => {
        if (!submitting) onClose();
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-input-create-title"
        className="sto-overlay sto-overlay--dialog flex h-[354px] w-[460px] flex-col overflow-hidden rounded-[var(--sto-dialog-radius)] border p-0"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        data-quick-input-id={id || undefined}
      >
        <div className="flex h-[52px] w-full shrink-0 items-center justify-between bg-[var(--sto-dialog-background)] p-4">
          <h2
            id="quick-input-create-title"
            className="text-base font-semibold leading-6 text-[#1D2129] dark:text-foreground"
          >
            {isEditing
              ? t('composer.quickInputEditModalTitle')
              : t('composer.quickInputCreateModalTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#86909C] transition-colors hover:bg-[#F2F3F5] hover:text-[#1D2129] disabled:opacity-50 dark:hover:bg-muted dark:hover:text-foreground"
            aria-label={t('composer.quickInputCreateCloseAria')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex h-[238px] w-full flex-col gap-2 self-stretch px-4 py-2">
          <div className="flex items-center justify-between gap-3">
            <label
              htmlFor="quick-input-create-content"
              className="text-sm font-medium leading-5 text-[#1D2129] dark:text-foreground"
            >
              {t('composer.quickInputCreateContentLabel')}
            </label>
            <AiBeautifyButton
              type="prompt"
              value={content}
              onBeautified={(next) => {
                setContent(next);
                if (error) setError(undefined);
              }}
              onEmpty={() => setError(t('composer.quickInputCreateContentRequired'))}
            />
          </div>

          <textarea
            id="quick-input-create-content"
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              if (error) setError(undefined);
            }}
            rows={8}
            maxLength={5000}
            disabled={submitting}
            placeholder={t('composer.quickInputCreatePlaceholder')}
            className={cn(
              'box-border h-[200px] w-full flex-grow resize-none self-stretch',
              'flex flex-col justify-between rounded-lg border bg-white px-2 py-1.5',
              'text-sm leading-relaxed text-[#1D2129] outline-none transition-colors',
              'placeholder:text-[#C9CDD4] focus:border-[#C9CDD4]',
              'dark:border-border dark:bg-background dark:text-foreground',
              'disabled:opacity-60',
              error ? 'border-destructive' : 'border-[#E5E6EB]',
            )}
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>

        <div className="sto-dialog-footer h-16 w-full items-center p-4">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={submitting}
            className="box-border flex h-[34px] w-[60px] flex-col items-center justify-center rounded-xl border border-[#E5E6EB] bg-white px-4 py-2 text-sm font-medium text-[#1D2129] hover:bg-white dark:border-[var(--sto-dialog-border)] dark:bg-[var(--sto-dialog-background)] dark:text-[var(--sto-text-primary)]"
          >
            {t('composer.quickInputCreateCancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={submitting}
            className="box-border flex h-[34px] min-w-[60px] flex-col items-center justify-center rounded-xl border-none bg-[#1D2129] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D2129]/90 dark:bg-[var(--sto-dialog-action-background)] dark:text-[var(--sto-dialog-action-foreground)] dark:hover:bg-[var(--sto-dialog-action-hover-background)]"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              t('composer.quickInputCreateConfirm')
            )}
          </Button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
