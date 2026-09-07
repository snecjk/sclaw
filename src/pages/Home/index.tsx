import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { HomeAgentHubSurface } from './HomeAgentHubSurface';
import { useHomeConversationActive } from './use-home-conversation-active';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { createAutoSendWatcher } from '@/stores/message-queue';
import { readMainChatDraftState } from '@/lib/main-chat-navigation';
import { useJsBridgeHostStore } from '@/stores/jsbridge-host';
import {
  dispatchJsBridgeStructuredComposerSeed,
  shouldApplyJsBridgeStructuredComposerSeed,
} from '@/lib/jsbridge/apply-composer-seed';
import { cn } from '@/lib/utils';
import { useSplitGridPassthroughClass } from '@/hooks/use-split-grid-passthrough-class';
import { useHomeChatEntrySend } from './use-home-chat-entry-send';
import { CHAT_EDIT_DRAFT_EVENT, type ChatEditDraftEventDetail } from '@/pages/Chat/ChatInput';
import { resolveWorkflowEngineSelection, useWorkflowEnginePolicy } from '@/hooks/use-workflow-engine-policy';
import { parseAgentEngineType } from '../../../shared/agent-engine';

/**
 * 首页：所有用户统一走 HomeAgentHubSurface，由后端推荐位 API 动态返回不同内容。
 */
export function Home() {
  const workflowEnginePolicy = useWorkflowEnginePolicy();
  // 开预览时外层须 display:contents，否则对话/预览列进不了 main 的三栏 grid（白屏）
  const showConversation = useHomeConversationActive();
  const { splitGridPassthroughClass } =
    useSplitGridPassthroughClass(showConversation);
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
  const isWorkflowRun = searchParams.get('workflowRun') === '1';
  const workflowEngine = resolveWorkflowEngineSelection(
    parseAgentEngineType(searchParams.get('workflowEngine')),
    workflowEnginePolicy.options,
    workflowEnginePolicy.defaultEngine,
  );

  // 连接器「去试试」经 router state 携带的一次性输入草稿（刻意不走 ?q=：
  // q 会被自动发送，草稿只允许预填输入框由用户手动发送）。消费后立即
  // 清掉路由 state，防止刷新 / 返回 / 重渲染再次覆盖用户正在编辑的内容。
  const location = useLocation();
  const navigate = useNavigate();
  const locationState = location.state;
  const draftState = readMainChatDraftState(locationState);
  const bridgeMainSeed = useJsBridgeHostStore((s) => s.mainComposerSeed);
  const consumedDraftTokensRef = useRef<Set<string>>(new Set());
  const structuredBridgeSeed = shouldApplyJsBridgeStructuredComposerSeed(bridgeMainSeed);
  const seedText = draftState?.composerHandoff
    ? undefined
    : draftState?.mainChatDraft ?? (structuredBridgeSeed ? undefined : bridgeMainSeed?.text);

  useEffect(() => {
    dispatchJsBridgeStructuredComposerSeed(bridgeMainSeed);
  }, [bridgeMainSeed]);

  useEffect(() => {
    const currentDraft = readMainChatDraftState(locationState);
    if (!currentDraft) return;
    const token = currentDraft.mainChatDraftToken;
    if (token) {
      if (consumedDraftTokensRef.current.has(token)) return;
      consumedDraftTokensRef.current.add(token);
    }
    const handoff = currentDraft.composerHandoff;
    if (handoff) {
      // Child effects register the ChatInput listener first, then this parent
      // effect replays the same event homepage recommend cards use.
      window.dispatchEvent(new CustomEvent<ChatEditDraftEventDetail>(CHAT_EDIT_DRAFT_EVENT, {
        detail: handoff,
      }));
    }
    // 子组件 effect 先于父组件执行：DingTalkMentionEditor 此时已把草稿
    // 写入输入框并聚焦，清掉 state 只会让 seedText prop 变回 undefined，
    // 不会清空已填充的草稿。
    navigate(location.pathname, { replace: true, state: null });
  }, [locationState, location.pathname, navigate]);

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
    // q 被清空后复位，允许下一次 ?q= 跳转（配置/启动工作流连续点击）再次自动发送。
    // 仅靠 setSearchParams 清 q 防重复刷新；ref 只在同一份 q 的生命周期内防重发。
    if (!querySeedText) {
      hasAutoSentRef.current = false;
      return;
    }
    if (hasAutoSentRef.current) return;
    if (gatewayStatus.state !== 'running' && !isWorkflowRun) return;
    if (isWorkflowRun && (!workflowEnginePolicy.loaded || workflowEnginePolicy.loading)) return;

    hasAutoSentRef.current = true;
    // Clear q and workflow metadata from URL so refresh doesn't re-trigger
    setSearchParams({}, { replace: true });
    void (async () => {
      if (isWorkflowRun) {
        try {
          const { currentAgentId, currentSessionKey } = useChatStore.getState();
          const { configureWorkflowRunSession } = await import('@/lib/workflow-run-session-engine');
          await configureWorkflowRunSession({
            sessionKey: currentSessionKey,
            agentId: currentAgentId || 'main',
            engineType: workflowEngine,
          });
        } catch (error) {
          toast.error(error instanceof Error ? error.message : '工作流运行引擎初始化失败');
          return;
        }
      }
      if (isWorkflowRun) {
        await handleHubSend(
          querySeedText,
          undefined,
          undefined,
          undefined,
          seedWorkflowId,
          undefined,
          undefined,
          undefined,
          { workflowExecutionEngine: workflowEngine },
        );
      } else {
        await handleHubSend(querySeedText, undefined, undefined, undefined, seedWorkflowId);
      }
    })();
  }, [querySeedText, seedWorkflowId, isWorkflowRun, workflowEngine, workflowEnginePolicy.loaded, workflowEnginePolicy.loading, gatewayStatus.state, handleHubSend, setSearchParams]);

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
          splitGridPassthroughClass
            ?? 'mx-auto flex h-full max-h-full min-h-0 w-full flex-1 flex-col overflow-hidden',
        )}
      >
            <HomeAgentHubSurface
              seedText={seedText}
              seedSkillSlug={seedSkillSlug}
        />
      </div>

    </>
  );
}
