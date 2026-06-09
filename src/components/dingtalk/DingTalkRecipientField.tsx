import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { DingTalkMentionEditor, type DingTalkMentionEditorHandle } from '@/components/dingtalk/DingTalkMentionEditor';
import { DingTalkMentionPopover } from '@/components/dingtalk/DingTalkMentionPopover';
import { useDingTalkMention } from '@/hooks/useDingTalkMention';
import type { ActiveMentionTrigger } from '@/lib/dingtalk-mention-composer';
import type { DingTalkMention, MentionSearchItem } from '@/types/dingtalk-mention';
import { mentionSearchItemToMention } from '@/types/dingtalk-mention';

interface DingTalkRecipientFieldProps {
  value?: DingTalkMention[];
  onChange?: (mentions: DingTalkMention[]) => void;
  disabled?: boolean;
  className?: string;
}

export function DingTalkRecipientField({
  value = [],
  onChange,
  disabled = false,
  className,
}: DingTalkRecipientFieldProps) {
  const [mentionTrigger, setMentionTrigger] = useState<ActiveMentionTrigger | null>(null);
  const mentionEditorRef = useRef<DingTalkMentionEditorHandle>(null);
  const isComposingRef = useRef(false);
  const seededValueRef = useRef('');

  const {
    open: dingTalkMentionOpen,
    items: dingTalkItems,
    recent: dingTalkRecent,
    loading: dingTalkLoading,
    loadingMore: dingTalkLoadingMore,
    hasMore: dingTalkHasMore,
    loadMore: loadMoreDingTalkMentions,
    error: dingTalkError,
    needsAuth: dingTalkNeedsAuth,
    needsInstall: dingTalkNeedsInstall,
    activeIndex: dingTalkActiveIndex,
    setActiveIndex: setDingTalkActiveIndex,
    moveActive: moveDingTalkActive,
    close: closeDingTalkMention,
    login: loginDingTalkMention,
    loggingIn: dingTalkLoggingIn,
    install: installDingTalkMention,
    installing: dingTalkInstalling,
  } = useDingTalkMention(mentionTrigger);

  const valueKey = value.map((mention) => {
    if (mention.type === 'user') return `u:${mention.userId}`;
    return `g:${mention.openConversationId}`;
  }).join('|');

  useEffect(() => {
    if (seededValueRef.current === valueKey) return;
    seededValueRef.current = valueKey;
    mentionEditorRef.current?.setMentions(value);
  }, [value, valueKey]);

  const applyDingTalkMention = useCallback((item: MentionSearchItem) => {
    if (!mentionTrigger) return;
    const mention = mentionSearchItemToMention(item);
    mentionEditorRef.current?.insertMention(mention, mentionTrigger);
    closeDingTalkMention();
    setMentionTrigger(null);
  }, [closeDingTalkMention, mentionTrigger]);

  const handleSnapshotChange = useCallback((snapshot: { mentions: DingTalkMention[] }) => {
    onChange?.(snapshot.mentions);
  }, [onChange]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (dingTalkMentionOpen && dingTalkItems.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveDingTalkActive(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveDingTalkActive(-1);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDingTalkMention();
        return;
      }
      if (event.key === 'Enter') {
        const nativeEvent = event.nativeEvent as KeyboardEvent;
        if (!isComposingRef.current && !nativeEvent.isComposing && nativeEvent.keyCode !== 229) {
          event.preventDefault();
          const selected = dingTalkItems[dingTalkActiveIndex];
          if (selected) applyDingTalkMention(selected);
        }
      }
    }
  }, [
    applyDingTalkMention,
    closeDingTalkMention,
    dingTalkActiveIndex,
    dingTalkItems,
    dingTalkMentionOpen,
    moveDingTalkActive,
  ]);

  return (
    <div className={className}>
      <div
        className={cn(
          'relative rounded-lg border bg-background px-3 py-2 transition-colors',
          'focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30',
          disabled ? 'cursor-not-allowed opacity-60' : 'border-border',
        )}
      >
        <div className="relative">
          <DingTalkMentionPopover
            open={dingTalkMentionOpen}
            items={dingTalkItems}
            query={mentionTrigger?.query ?? ''}
            recent={dingTalkRecent}
            loading={dingTalkLoading}
            loadingMore={dingTalkLoadingMore}
            hasMore={dingTalkHasMore}
            loggingIn={dingTalkLoggingIn}
            installing={dingTalkInstalling}
            error={dingTalkError}
            needsAuth={dingTalkNeedsAuth}
            needsInstall={dingTalkNeedsInstall}
            activeIndex={dingTalkActiveIndex}
            onHoverIndex={setDingTalkActiveIndex}
            onSelect={applyDingTalkMention}
            onLogin={loginDingTalkMention}
            onInstall={installDingTalkMention}
            onLoadMore={loadMoreDingTalkMentions}
          />
          <DingTalkMentionEditor
            ref={mentionEditorRef}
            placeholder="输入 @ 搜索联系人和群，可多选"
            disabled={disabled}
            removableMentions
            className="min-h-[28px] max-h-[120px] text-[13px] leading-6"
            onSnapshotChange={handleSnapshotChange}
            onTriggerChange={setMentionTrigger}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
          />
        </div>
      </div>
      <p className="text-[11.5px] text-muted-foreground mt-1">
        任务执行完成后，结果将自动发送给选中的对象
      </p>
    </div>
  );
}
