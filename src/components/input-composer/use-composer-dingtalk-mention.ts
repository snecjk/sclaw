/**
 * 钉钉 @ 提及接线：触发态 + 搜索 hook + 选中插入 / 键盘导航。
 * 只管浮层；发送时如何 bake mentions 仍由装配层决定。
 *
 * ## Types
 * - `UseComposerDingTalkMentionOptions` — editor ref、是否启用、IME composing ref
 * - `ComposerDingTalkMention` — 返回 trigger/items/popoverProps/键盘 handler
 */
import { useCallback, useState, type RefObject } from 'react';
import type { DingTalkMentionEditorHandle } from '@/components/dingtalk/DingTalkMentionEditor';
import { useDingTalkMention } from '@/hooks/useDingTalkMention';
import type { ActiveMentionTrigger } from '@/lib/dingtalk-mention-composer';
import type { MentionSearchItem } from '@/types/dingtalk-mention';
import { mentionSearchItemToMention } from '@/types/dingtalk-mention';

/** 提及 hook 选项；`enabled` 默认 true */
export interface UseComposerDingTalkMentionOptions {
  /** MentionEditor 句柄（插入 mention） */
  mentionEditorRef: RefObject<DingTalkMentionEditorHandle | null>;
  /** 是否启用；默认 true */
  enabled?: boolean;
  /** IME 组合输入中标记（组合期不抢键盘） */
  isComposingRef?: RefObject<boolean>;
  /**
   * 浮层锚定元素：有则透传给 DingTalkMentionPopover.anchorRef，触发 portal + fixed
   * 定位，避免被 Modal / 输入壳 overflow 裁切（问题一）。
   */
  mentionPopoverHostRef?: RefObject<HTMLElement | null>;
}

export function useComposerDingTalkMention({
  mentionEditorRef,
  enabled = true,
  isComposingRef,
  mentionPopoverHostRef,
}: UseComposerDingTalkMentionOptions) {
  const [mentionTrigger, setMentionTrigger] = useState<ActiveMentionTrigger | null>(null);
  const dingTalk = useDingTalkMention(mentionTrigger, enabled);
  const {
    open: dingTalkOpen,
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
    close: closeDingTalkHook,
    login: loginDingTalkMention,
    loggingIn: dingTalkLoggingIn,
    install: installDingTalkMention,
    installing: dingTalkInstalling,
  } = dingTalk;

  const closeDingTalkMention = useCallback(() => {
    closeDingTalkHook();
    setMentionTrigger(null);
  }, [closeDingTalkHook]);

  const closeForWorkflowSlash = useCallback(() => {
    if (dingTalkOpen) {
      closeDingTalkHook();
      setMentionTrigger(null);
    }
  }, [closeDingTalkHook, dingTalkOpen]);

  const applyDingTalkMention = useCallback(
    (item: MentionSearchItem) => {
      if (!mentionTrigger) return;
      const mention = mentionSearchItemToMention(item);
      mentionEditorRef.current?.insertMention(mention, mentionTrigger);
      closeDingTalkHook();
      setMentionTrigger(null);
    },
    [closeDingTalkHook, mentionEditorRef, mentionTrigger],
  );

  /**
   * 处理提及浮层键盘；已处理返回 true。
   * Enter 选中不冒泡到外层发送。
   */
  const handleMentionKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!dingTalkOpen || dingTalkItems.length === 0) return false;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveDingTalkActive(1);
        return true;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveDingTalkActive(-1);
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDingTalkMention();
        return true;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const nativeEvent = e.nativeEvent as KeyboardEvent;
        const composing =
          isComposingRef?.current
          || nativeEvent.isComposing
          || nativeEvent.keyCode === 229;
        if (!composing) {
          e.preventDefault();
          const selected = dingTalkItems[dingTalkActiveIndex];
          if (selected) applyDingTalkMention(selected);
          return true;
        }
      }
      return false;
    },
    [
      applyDingTalkMention,
      closeDingTalkMention,
      dingTalkActiveIndex,
      dingTalkItems,
      dingTalkOpen,
      isComposingRef,
      moveDingTalkActive,
    ],
  );

  const getMentionEditorElement = useCallback(
    () => mentionEditorRef.current?.getEditorElement() ?? null,
    [mentionEditorRef],
  );

  return {
    mentionTrigger,
    setMentionTrigger,
    dingTalkOpen,
    dingTalkItems,
    dingTalkRecent,
    dingTalkLoading,
    dingTalkLoadingMore,
    dingTalkHasMore,
    dingTalkError,
    dingTalkNeedsAuth,
    dingTalkNeedsInstall,
    dingTalkActiveIndex,
    setDingTalkActiveIndex,
    moveDingTalkActive,
    loadMoreDingTalkMentions,
    loginDingTalkMention,
    dingTalkLoggingIn,
    installDingTalkMention,
    dingTalkInstalling,
    closeDingTalkMention,
    closeForWorkflowSlash,
    applyDingTalkMention,
    handleMentionKeyDown,
    popoverProps: {
      open: dingTalkOpen,
      items: dingTalkItems,
      query: mentionTrigger?.query ?? '',
      recent: dingTalkRecent,
      loading: dingTalkLoading,
      loadingMore: dingTalkLoadingMore,
      hasMore: dingTalkHasMore,
      loggingIn: dingTalkLoggingIn,
      installing: dingTalkInstalling,
      error: dingTalkError,
      needsAuth: dingTalkNeedsAuth,
      needsInstall: dingTalkNeedsInstall,
      activeIndex: dingTalkActiveIndex,
      onHoverIndex: setDingTalkActiveIndex,
      onSelect: applyDingTalkMention,
      onLogin: loginDingTalkMention,
      onInstall: installDingTalkMention,
      onLoadMore: loadMoreDingTalkMentions,
      anchorRef: mentionPopoverHostRef,
      mentionTrigger,
      getEditorElement: getMentionEditorElement,
      onDismissOutside: closeDingTalkMention,
      dismissOutsideExcludeRef: mentionPopoverHostRef,
    },
  };
}

/** 提及 hook 返回值（含可直接铺给 DingTalkMentionPopover 的 `popoverProps`） */
export type ComposerDingTalkMention = ReturnType<typeof useComposerDingTalkMention>;
