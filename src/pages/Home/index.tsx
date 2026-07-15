import { useEffect, useRef, useState } from 'react';
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

  // Handle skill-plaza "Use" navigation with ?q= prompt and ?workflowId= template pick
  const [searchParams, setSearchParams] = useSearchParams();
  // searchParams.get() is already percent-decoded; decodeURIComponent again throws
  // URIError when the prompt contains a literal '%' (e.g. "完成率50%").
  const querySeedText = searchParams.get('q')?.trim() || undefined;
  const seedWorkflowId = searchParams.get('workflowId')?.trim() || undefined;
  const { handleHubSend } = useHomeChatEntrySend();
  const gatewayStatus = useGatewayStore((s) => s.status);
  const hasAutoSentRef = useRef(false);
  const [draftSeedText, setDraftSeedText] = useState<string | undefined>();

  useEffect(() => {
    if (!querySeedText || seedWorkflowId) return;

    setDraftSeedText(querySeedText);
    setSearchParams({}, { replace: true });
  }, [querySeedText, seedWorkflowId, setSearchParams]);

  useEffect(() => {
    if (!querySeedText || !seedWorkflowId || hasAutoSentRef.current) return;
    if (gatewayStatus.state !== 'running') return;

    hasAutoSentRef.current = true;
    // Clear q and workflowId from URL so refresh doesn't re-trigger
    setSearchParams({}, { replace: true });
    handleHubSend(querySeedText, undefined, undefined, undefined, seedWorkflowId);
  }, [querySeedText, seedWorkflowId, gatewayStatus.state, handleHubSend, setSearchParams]);

  // Wait for gateway before auto-sending workflowId prompt.
  if (gatewayStatus.state !== 'running' && querySeedText && seedWorkflowId && !hasAutoSentRef.current) {
    // gateway not ready yet; will be sent once it's running (handled by effect below)
  }

  return (
    <>
      <div
        className={cn(
          isSplitGridPassthrough
            ? splitGridPassthroughClass
            : 'mx-auto flex h-full max-h-full min-h-0 w-full flex-1 flex-col overflow-hidden px-1 pt-2 sm:px-2',
        )}
      >
        <HomeAgentHubSurface seedText={draftSeedText} />
      </div>

    </>
  );
}
