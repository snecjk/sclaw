/**
 * Pending Queue Panel
 * Displays queued messages above the chat input when the AI is responding.
 * Supports reordering (up/down) and deletion of queued items.
 */
import { memo } from 'react';
import { ChevronUp, ChevronDown, X, Paperclip, AtSign } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import type { QueuedMessage } from '@/stores/message-queue';

interface PendingQueuePanelProps {
  queue: QueuedMessage[];
  onRemove: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  /** Override the outer wrapper width/padding to align with the host composer. */
  className?: string;
}

function truncateText(text: string, max = 60): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

const QueueItem = memo(function QueueItem({
  item,
  index,
  total,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  item: QueuedMessage;
  index: number;
  total: number;
  onRemove: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
}) {
  const { t } = useTranslation('chat');
  const hasAttachments = item.attachments && item.attachments.length > 0;
  const isFirst = index === 0;
  const isLast = index === total - 1;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="group flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-1.5 text-[13px]"
    >
      {/* Text preview */}
      <span className="min-w-0 flex-1 truncate text-foreground/80">
        {truncateText(item.text)}
      </span>

      {/* Attachment badge */}
      {hasAttachments && (
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
          <Paperclip className="h-3 w-3" />
          {t('queue.fileCount', { count: item.attachments!.length })}
        </span>
      )}

      {/* Target agent badge */}
      {item.targetAgentId && (
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-primary/6 px-1.5 py-0.5 text-[11px] font-medium text-foreground/70">
          <AtSign className="h-2.5 w-2.5" />
          {item.targetAgentId}
        </span>
      )}

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 rounded p-0 text-muted-foreground/60 hover:text-foreground"
          onClick={() => onMoveUp(item.id)}
          disabled={isFirst}
          title={t('queue.moveUp')}
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 rounded p-0 text-muted-foreground/60 hover:text-foreground"
          onClick={() => onMoveDown(item.id)}
          disabled={isLast}
          title={t('queue.moveDown')}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 rounded p-0 text-muted-foreground/60 hover:text-destructive"
          onClick={() => onRemove(item.id)}
          title={t('queue.remove')}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </motion.div>
  );
});

export function PendingQueuePanel({ queue, onRemove, onMoveUp, onMoveDown, className }: PendingQueuePanelProps) {
  const { t } = useTranslation('chat');

  if (queue.length === 0) return null;

  return (
    <div className={cn('w-full px-6 pb-1', className)}>
      <div className="rounded-xl border border-border/40 bg-white/40 p-2 shadow-sm backdrop-blur-sm dark:bg-white/[0.03]">
        <div className="mb-1.5 px-1 text-[11px] font-medium text-muted-foreground/70">
          {t('queue.label', { count: queue.length })}
        </div>
        <div className={cn('space-y-1', queue.length > 4 && 'max-h-[160px] overflow-y-auto')}>
          <AnimatePresence mode="popLayout">
            {queue.map((item, index) => (
              <QueueItem
                key={item.id}
                item={item}
                index={index}
                total={queue.length}
                onRemove={onRemove}
                onMoveUp={onMoveUp}
                onMoveDown={onMoveDown}
              />
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
