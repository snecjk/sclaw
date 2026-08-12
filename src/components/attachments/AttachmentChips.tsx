import { File, FileArchive, FileText, Film, Loader2, Music, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FileAttachment } from './types';

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType.startsWith('video/')) return <Film className={className} />;
  if (mimeType.startsWith('audio/')) return <Music className={className} />;
  if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') {
    return <FileText className={className} />;
  }
  if (
    mimeType.includes('zip')
    || mimeType.includes('compressed')
    || mimeType.includes('archive')
    || mimeType.includes('tar')
    || mimeType.includes('rar')
    || mimeType.includes('7z')
  ) {
    return <FileArchive className={className} />;
  }
  if (mimeType === 'application/pdf') return <FileText className={className} />;
  return <File className={className} />;
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
    <div className="relative group rounded-md overflow-hidden border border-border">
      {isImage ? (
        <div className="h-12 w-12 shrink-0">
          <img
            src={attachment.preview!}
            alt={attachment.fileName}
            className="h-full w-full object-cover"
          />
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 max-w-[200px]">
          <FileIcon mimeType={attachment.mimeType} className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 overflow-hidden">
            <p className="text-xs font-medium truncate">{attachment.fileName}</p>
            <p className="text-[10px] text-muted-foreground">
              {attachment.fileSize > 0 ? formatFileSize(attachment.fileSize) : '...'}
            </p>
          </div>
        </div>
      )}

      {attachment.status === 'staging' && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
          <Loader2 className="h-4 w-4 text-white animate-spin" />
        </div>
      )}

      {attachment.status === 'error' && (
        <div className="absolute inset-0 bg-destructive/20 flex items-center justify-center">
          <span className="text-[10px] text-destructive font-medium px-1">Error</span>
        </div>
      )}

      <button
        type="button"
        onClick={onRemove}
        className={cn(
          'absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full',
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

/** 输入框顶部附件 chips 行 */
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
