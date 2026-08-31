/**
 * Pending Queue Panel
 * Displays queued messages above the chat input when the AI is responding.
 */
import { memo, useState } from 'react';
import { ArrowUp, ChevronUp, ChevronDown, X, Paperclip, AtSign, Pencil } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import type { QueuedMessage } from '@/stores/message-queue';
import { sendImmediately, useMessageQueueStore } from '@/stores/message-queue';
import { SkillMessageTag } from '@/components/skill-plaza/SkillMessageTag';
import {
  UserComposerFileChip,
  UserComposerSegmentsContent,
  UserWorkflowMessageTag,
} from '@/components/input-composer/user-composer-segments';

interface PendingQueuePanelProps {
  sessionKey: string;
  queue: QueuedMessage[];
  onRemove: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
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
  sessionKey,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  item: QueuedMessage;
  index: number;
  total: number;
  sessionKey: string;
  onRemove: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
}) {
  const { t } = useTranslation('chat');
  const updateText = useMessageQueueStore((s) => s.updateText);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const skillList = item.skillMetas ?? (item.skillMeta ? [item.skillMeta] : []);
  const hasAttachments = Boolean(item.attachments?.length);
  const hasSegments = Boolean(item.composerSegments?.length);
  const hasChips = hasSegments
    || Boolean(item.attachments?.length || skillList.length || item.workflows?.length);
  const isFirst = index === 0;
  const isLast = index === total - 1;

  const commitEdit = () => {
    updateText(sessionKey, item.id, draft);
    setEditing(false);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="group flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-1.5 text-[13px]"
    >
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit();
            if (e.key === 'Escape') setEditing(false);
          }}
          onBlur={commitEdit}
          className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-[13px]"
        />
      ) : (
        <span className="min-w-0 flex-1 text-foreground/80">
          {hasSegments ? (
            // 单行截断：segments 文本可能几百字，flex-wrap 会把队列项撑高
            <span className="block min-w-0 truncate [&_.skill-token]:mt-0 [&_.attachment-token]:mt-0 [&_span:has(>.workflow-token-label)]:mt-0">
              <UserComposerSegmentsContent segments={item.composerSegments!} />
            </span>
          ) : hasChips ? (
            <span className="flex flex-wrap items-center [&_.skill-token]:mt-0 [&_.attachment-token]:mt-0 [&_span:has(>.workflow-token-label)]:mt-0">
              {item.text ? <span className="truncate">{truncateText(item.text)}</span> : null}
              {item.attachments?.map((file, fileIndex) => (
                <UserComposerFileChip
                  key={`file-${fileIndex}`}
                  fileName={file.fileName}
                  mimeType={file.mimeType}
                />
              ))}
              {skillList.map((skill) => (
                <SkillMessageTag key={`skill-${skill.slug}`} title={skill.title} />
              ))}
              {item.workflows?.map((workflow) => (
                <UserWorkflowMessageTag key={`workflow-${workflow.id}`} workflowName={workflow.name} />
              ))}
            </span>
          ) : (
            <span className="block truncate">{truncateText(item.text)}</span>
          )}
        </span>
      )}

      {hasAttachments && !hasChips && (
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
          <Paperclip className="h-3 w-3" />
          {t('queue.fileCount', { count: item.attachments!.length })}
        </span>
      )}

      {item.targetAgentId && (
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-primary/6 px-1.5 py-0.5 text-[11px] font-medium text-foreground/70">
          <AtSign className="h-2.5 w-2.5" />
          {item.targetAgentId}
        </span>
      )}

      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 rounded p-0 text-muted-foreground/60 hover:text-foreground"
          onClick={() => {
            setDraft(item.text);
            setEditing(true);
          }}
          title={t('queue.edit')}
        >
          <Pencil className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 rounded p-0 text-muted-foreground/60 hover:text-foreground"
          onClick={() => void sendImmediately(sessionKey, item.id)}
          title={t('queue.sendImmediately')}
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
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

export function PendingQueuePanel({
  sessionKey,
  queue,
  onRemove,
  onMoveUp,
  onMoveDown,
  className,
}: PendingQueuePanelProps) {
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
                sessionKey={sessionKey}
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
