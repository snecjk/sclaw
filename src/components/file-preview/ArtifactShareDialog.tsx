/**
 * ArtifactShareDialog — confirm title, body, and link before sharing to DingTalk.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { ArtifactShareDraft } from '@/lib/dingtalk-share';

export interface ArtifactShareDialogProps {
  open: boolean;
  draft: ArtifactShareDraft | null;
  onConfirm: (values: { title: string; text: string; url: string }) => void | Promise<void>;
  onCancel: () => void;
  onError?: (error: unknown) => void;
}

export function ArtifactShareDialog({
  open,
  draft,
  onConfirm,
  onCancel,
  onError,
}: ArtifactShareDialogProps) {
  const { t } = useTranslation('chat');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open || !draft) return;
    setTitle(draft.title);
    setText(draft.text);
    setUrl(draft.url);
    setConfirming(false);
  }, [open, draft]);

  useEffect(() => {
    if (open && cancelRef.current) {
      cancelRef.current.focus();
    }
  }, [open]);

  if (!open || !draft) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !confirming) {
      e.preventDefault();
      onCancel();
    }
  };

  const handleConfirm = () => {
    if (confirming) return;
    const trimmedUrl = url.trim();
    const trimmedText = text.trim();
    if (!trimmedUrl) return;
    const result = onConfirm({
      title: title.trim() || draft.title,
      text: trimmedText || draft.text,
      url: trimmedUrl,
    });
    if (result instanceof Promise) {
      setConfirming(true);
      result.catch((error) => onError?.(error)).finally(() => setConfirming(false));
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.42)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="artifact-share-dialog-title"
      onKeyDown={handleKeyDown}
    >
      <div
        className={cn(
          'mx-4 w-full max-w-[480px] rounded-2xl border border-glass-border glass-panel p-6',
          'shadow-2xl focus:outline-none',
        )}
        tabIndex={-1}
      >
        <h2 id="artifact-share-dialog-title" className="text-lg font-semibold">
          {t('preview.shareDialog.title')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('preview.shareDialog.description')}
        </p>

        <div className="mt-4 space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t('preview.shareDialog.fieldTitle')}
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t('preview.shareDialog.fieldBody')}
            </span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t('preview.shareDialog.fieldLink')}
            </span>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        </div>

        {draft.isLocalServeUrl ? (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
            {t('preview.shareDialog.localUrlHint')}
          </p>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <Button
            ref={cancelRef}
            variant="outline"
            onClick={onCancel}
            disabled={confirming}
            className="rounded-full px-5"
          >
            {t('preview.shareDialog.cancel')}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={confirming || !url.trim()}
            className="rounded-full px-5"
          >
            {t('preview.shareDialog.confirm')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
