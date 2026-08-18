import { type RefObject } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { LearningCoverImage } from './LearningCoverImage';

interface CaseCoverPreviewDialogProps {
  open: boolean;
  title: string;
  imageUrl: string;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

export function CaseCoverPreviewDialog({
  open,
  title,
  imageUrl,
  returnFocusRef,
  onClose,
}: CaseCoverPreviewDialogProps) {
  const { t } = useTranslation('learningCenter');
  const showImage = Boolean(imageUrl.trim());

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        overlayClassName="bg-black/60 backdrop-blur-none"
        className={`learning-center-cover-preview max-h-none max-w-none p-0${showImage ? '' : ' learning-center-cover-preview--empty'}`}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">{t('casePreviewCover', { title })}</DialogTitle>
        <DialogDescription className="sr-only">{t('caseCoverAlt', { title })}</DialogDescription>
        <button
          type="button"
          className="learning-center-cover-preview__close"
          aria-label={t('close')}
          onClick={onClose}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
        <LearningCoverImage
          url={imageUrl}
          alt={t('caseCoverAlt', { title })}
          className="learning-center-cover-preview__image"
          iconClassName="h-12 w-12"
        />
      </DialogContent>
    </Dialog>
  );
}
