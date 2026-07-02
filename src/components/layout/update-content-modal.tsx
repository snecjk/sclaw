import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { modalPrimarySubmitButtonClass } from '@/lib/surfaces';

interface UpdateContentModalProps {
  open: boolean;
  version?: string | null;
  title?: string | null;
  releaseNotes?: string | null;
  onClose: () => void;
}

function UpdateRocketIllustration() {
  return (
    <svg
      viewBox="0 0 320 160"
      className="mx-auto h-[140px] w-full max-w-[280px] text-[var(--sto-grey-10,#1D2129)]"
      aria-hidden
    >
      <circle cx="260" cy="36" r="2" fill="currentColor" opacity="0.35" />
      <circle cx="278" cy="52" r="1.5" fill="currentColor" opacity="0.25" />
      <circle cx="248" cy="58" r="1.5" fill="currentColor" opacity="0.2" />
      <path
        d="M40 120 L160 72 L280 120"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M160 72 L160 118"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M148 118 Q160 108 172 118"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M160 72 L132 48 L160 58 L188 48 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M148 58 L112 72 L132 78"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M172 58 L208 72 L188 78"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M152 78 L160 98 L168 78"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M156 98 Q160 108 164 98"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M72 96 Q96 88 120 96"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.5"
      />
      <path
        d="M200 96 Q224 88 248 96"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.5"
      />
    </svg>
  );
}

export function UpdateContentModal({
  open,
  version,
  title,
  releaseNotes,
  onClose,
}: UpdateContentModalProps) {
  const { t } = useTranslation('settings');
  const navigate = useNavigate();
  const displayVersion = version?.trim() || '—';
  const notes = releaseNotes?.trim() || '';

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleViewChangelog = () => {
    onClose();
    navigate('/settings/updates');
  };

  return (
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={cn(
          'relative flex w-full max-w-[480px] flex-col overflow-hidden rounded-2xl bg-white shadow-xl',
          'dark:bg-card',
        )}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-content-modal-title"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]"
          aria-label={t('updates.modal.close')}
        >
          <X className="h-4 w-4" />
        </button>

        <div className="bg-[linear-gradient(180deg,#FAFBFC_0%,#FFFFFF_100%)] px-6 pb-2 pt-8 dark:bg-muted/30">
          <UpdateRocketIllustration />
        </div>

        <div className="flex flex-col gap-5 px-6 pb-6 pt-4">
          <h2
            id="update-content-modal-title"
            className="text-center text-lg font-semibold text-foreground"
          >
            {t('updates.modal.title', { version: displayVersion })}
          </h2>

          {notes && title?.trim() ? (
            <p className="-mt-2 text-center text-sm text-[#86909C]">{title.trim()}</p>
          ) : null}

          {notes ? (
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--sto-grey-9,#4E5969)] dark:text-muted-foreground">
              {notes}
            </div>
          ) : (
            <p className="text-center text-sm text-[#86909C] dark:text-muted-foreground">
              {t('updates.modal.noReleaseNotes')}
            </p>
          )}

          <div className="flex items-center justify-end gap-3 pt-1">
            <Button type="button" variant="outline" onClick={onClose} className="h-10 px-5">
              {t('updates.modal.close')}
            </Button>
            <Button
              type="button"
              onClick={handleViewChangelog}
              className={cn('h-10 px-5', modalPrimarySubmitButtonClass)}
            >
              {t('updates.modal.viewChangelog')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default UpdateContentModal;
