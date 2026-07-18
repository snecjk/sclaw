import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { HomeAgentHubSurface } from './HomeAgentHubSurface';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { createAutoSendWatcher } from '@/stores/message-queue';
import { cn } from '@/lib/utils';
import { useSplitGridPassthroughClass } from '@/hooks/use-split-grid-passthrough-class';
import { useHomeChatEntrySend } from './use-home-chat-entry-send';

/**
 * 首页：所有用户统一走 HomeAgentHubSurface，由后端推荐位 API 动态返回不同内容。
 */
export function Home() {
  const { isSplitGridPassthrough, splitGridPassthroughClass } =
    useSplitGridPassthroughClass(false);
  const cleanupEmptySession = useChatStore((s) => s.cleanupEmptySession);

  useEffect(() => {
    const unsub = createAutoSendWatcher();
    return unsub;
  }, []);

  useEffect(
    () => () => {
      cleanupEmptySession();
    },
    [cleanupEmptySession]
  );

  // Handle skill-plaza "Use" (?skill=) and legacy ?q= / ?workflowId= deep links
  const [searchParams, setSearchParams] = useSearchParams();
  const seedSkillSlug = searchParams.get('skill')?.trim() || undefined;
  // searchParams.get() is already percent-decoded; decodeURIComponent again throws
  // URIError when the prompt contains a literal '%' (e.g. "完成率50%").
  const querySeedText = searchParams.get('q')?.trim() || undefined;
  const seedWorkflowId = searchParams.get('workflowId')?.trim() || undefined;
  const { handleHubSend } = useHomeChatEntrySend();
  const gatewayStatus = useGatewayStore((s) => s.status);
  const hasAutoSentRef = useRef(false);

  useEffect(() => {
    if (!seedSkillSlug) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('skill');
      return next;
    }, { replace: true });
  }, [seedSkillSlug, setSearchParams]);

  // Deep-link handoff for `?q=` (workflow「立即运行」/官方安装等).
  // Skills use `?skill=` only and must not block this path — a prior merge
  // incorrectly required sticky initialSkillSlug, which dropped pure-q run-now.
  useEffect(() => {
    if (!querySeedText || hasAutoSentRef.current) return;
    if (gatewayStatus.state !== 'running') return;

    hasAutoSentRef.current = true;
    // Clear q and workflowId from URL so refresh doesn't re-trigger
    setSearchParams({}, { replace: true });
    handleHubSend(querySeedText, undefined, undefined, undefined, seedWorkflowId);
  }, [querySeedText, seedWorkflowId, gatewayStatus.state, handleHubSend, setSearchParams]);

  // Wait for gateway before auto-sending workflowId prompt.
  // if (gatewayStatus.state !== 'running' && querySeedText && seedWorkflowId && !hasAutoSentRef.current) {
  //   // gateway not ready yet; will be sent once it's running (handled by effect below)
  // }

  // `?q=` 是「立即运行/安装工作流」的自动发送深链：由下面的 effect 直接发送，
  // 不再把 querySeedText 作为 seedText 预填输入框 —— 否则 DingTalkMentionEditor
  // 写入 DOM 后不会被清空，发送完输入框里仍残留一份文本。
  // `?skill=` 走 seedSkillSlug，与此无关。
  return (
    <>
      <div
        className={cn(
          isSplitGridPassthrough
            ? splitGridPassthroughClass
            : 'mx-auto flex h-full max-h-full min-h-0 w-full flex-1 flex-col overflow-hidden px-1 pt-2 sm:px-2',
        )}
      >
        <HomeAgentHubSurface seedSkillSlug={seedSkillSlug} />
      </div>

    </>
  );
}
