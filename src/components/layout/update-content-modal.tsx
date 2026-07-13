import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { ReleaseChangelogMarkdown } from '@/components/settings/update/ReleaseChangelogMarkdown';
import updateContentHero from '@/assets/update-content-hero.png';

interface UpdateContentModalProps {
  open: boolean;
  version?: string | null;
  title?: string | null;
  releaseNotes?: string | null;
  onClose: () => void;
}

const updateModalBtnTextClass =
  "font-['PingFang_SC'] text-[14px] font-medium leading-[18px] tracking-normal";

const updateModalCloseBtnClass = cn(
  'inline-flex h-[34px] min-w-[60px] shrink-0 flex-row items-center justify-center rounded-[12px] box-border whitespace-nowrap',
  'border border-[#E5E6EB] bg-white px-4 py-2',
  updateModalBtnTextClass,
  'text-[#1D2129]',
  'hover:bg-[#FAFBFC] dark:border-border dark:bg-card dark:hover:bg-muted/40',
);

const updateModalChangelogBtnClass = cn(
  'inline-flex h-[34px] min-w-[116px] shrink-0 flex-row items-center justify-center rounded-[12px] box-border whitespace-nowrap',
  'bg-[#1D2129] px-4 py-2',
  updateModalBtnTextClass,
  'text-white',
  'hover:bg-[#1D2129]/90 dark:bg-foreground dark:hover:bg-foreground/90',
);

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
  const modalTitle = t('updates.modal.title', { version: displayVersion });
  const releaseTitle = title?.trim() || '';
  const showReleaseTitle = Boolean(releaseTitle && releaseTitle !== modalTitle);

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
      className="fixed inset-0 z-[10050] flex flex-row items-center justify-center gap-[10px] bg-[rgba(0,0,0,0.5)] p-[10px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={cn(
          'relative flex h-[412px] w-[400px] max-w-full flex-col overflow-hidden rounded-[12px] bg-white p-0',
          'dark:bg-card',
        )}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-content-modal-title"
      >
        <div className="shrink-0 px-3 pt-3">
          <div className="flex h-[180px] w-full items-center justify-center overflow-hidden bg-[#E9F2FA] dark:bg-muted/30">
            <img
              src={updateContentHero}
              alt=""
              className="h-full w-full object-contain"
            />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-4">
          <h2
            id="update-content-modal-title"
            className="shrink-0 text-[16px] font-bold leading-snug text-[#1D2129] dark:text-foreground"
          >
            {modalTitle}
          </h2>

          {showReleaseTitle ? (
            <p className="mt-1 shrink-0 text-[13px] text-[#86909C]">{releaseTitle}</p>
          ) : null}

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
            {notes ? (
              <ReleaseChangelogMarkdown content={notes} />
            ) : (
              <p className="text-[13px] text-[#86909C] dark:text-muted-foreground">
                {t('updates.modal.noReleaseNotes')}
              </p>
            )}
          </div>

          <div className="mt-4 flex shrink-0 items-center justify-end gap-3">
            <button type="button" onClick={onClose} className={updateModalCloseBtnClass}>
              {t('updates.modal.close')}
            </button>
            <button type="button" onClick={handleViewChangelog} className={updateModalChangelogBtnClass}>
              {t('updates.modal.viewChangelog')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default UpdateContentModal;
