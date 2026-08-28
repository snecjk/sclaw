import { Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FileAttachment } from './types';
import {
  ATTACHMENT_CHIP_SURFACE_CLASS,
  middleEllipsisFileName,
  resolveFileTypeIconSrc,
} from './file-type-icon';

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** 按扩展名 / mime 展示设计稿文件类型图标。 */
export function FileIcon({
  fileName,
  mimeType,
  className,
}: {
  fileName?: string;
  mimeType?: string;
  className?: string;
}) {
  const src = resolveFileTypeIconSrc(fileName || '', mimeType);
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      className={cn('h-4 w-4 shrink-0 object-contain', className)}
      draggable={false}
    />
  );
}

function AttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: FileAttachment;
  onRemove: () => void;
}) {
  const isImage = attachment.mimeType.startsWith('image/') && attachment.preview;

  return (
    <div className="relative group overflow-hidden">
      {isImage ? (
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border">
          <img
            src={attachment.preview!}
            alt={attachment.fileName}
            className="h-full w-full object-cover"
          />
        </div>
      ) : (
        <div className={cn(ATTACHMENT_CHIP_SURFACE_CLASS, 'w-max')}>
          <FileIcon fileName={attachment.fileName} mimeType={attachment.mimeType} />
          <span className="min-w-0 flex-1 truncate whitespace-nowrap" title={attachment.fileName}>
            {middleEllipsisFileName(attachment.fileName)}
          </span>
        </div>
      )}

      {attachment.status === 'staging' && (
        <div className="absolute inset-0 flex items-center justify-center rounded-[6px] bg-black/40">
          <Loader2 className="h-4 w-4 animate-spin text-white" />
        </div>
      )}

      {attachment.status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center rounded-[6px] bg-destructive/20">
          <span className="px-1 text-[10px] font-medium text-destructive">Error</span>
        </div>
      )}

      <button
        type="button"
        onClick={onRemove}
        className={cn(
          'absolute right-0 top-0 z-10 flex h-5 w-5 items-center justify-center rounded-full',
          'bg-destructive text-destructive-foreground shadow-sm ring-2 ring-background',
          'opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100',
        )}
        aria-label="移除附件"
      >
        <X className="h-3 w-3 shrink-0" strokeWidth={2.5} />
      </button>
    </div>
  );
}

export interface AttachmentChipsProps {
  attachments: FileAttachment[];
  onRemove: (id: string) => void;
  className?: string;
}

/** 输入框顶部附件 chips 行（Task 等非 inline 场景；多文件换行）。 */
export function AttachmentChips({ attachments, onRemove, className }: AttachmentChipsProps) {
  if (attachments.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap gap-2 px-4 pt-3 pb-1', className)}>
      {attachments.map((att) => (
        <AttachmentPreview
          key={att.id}
          attachment={att}
          onRemove={() => onRemove(att.id)}
        />
      ))}
    </div>
  );
}
