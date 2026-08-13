/**
 * Unified chat send dispatcher: workflow UI shortcuts then normal chat (model + builtin tools).
 * Used by Chat page and Home hub so behavior stays consistent.
 */
import { toast } from 'sonner';
import { useChatStore } from '@/stores/chat';
import { awaitSessionSendReadiness } from '@/lib/session-send-readiness';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';
import type { FileAttachment } from '@/pages/Chat/ChatInput';
import type { DingTalkMention } from '@/types/dingtalk-mention';
import type { SkillMeta } from '@/types/skill-meta';
import { useChatRuntimeV2Store } from '@/stores/chat/runtime-v2-store';

export interface DispatchChatSendOptions {
  text: string;
  attachments?: FileAttachment[];
  targetAgentId?: string | null;
  dingTalkMentions?: DingTalkMention[];
  workflowId?: string | null;
  /** 工作流来源：'mine' = 我的工作流-已发布（以工作流上下文发送，不取模版 schema）。 */
  workflowSource?: string | null;
  /** 工作流名称（mine 来源时用于上下文块）。 */
  workflowName?: string | null;
  skillMeta?: SkillMeta;
}

/**
 * Composer 序列化会把工作流标签的可见名称写入 plainText。
 * 发送前按名称切开，得到标签前 / 标签后的用户文案（不含标签名本身）。
 */
function extractWorkflowSurroundingText(
  plainText: string,
  workflowName: string,
): { before: string; after: string } {
  const text = plainText.replace(/\u00A0/g, ' ');
  const name = workflowName.trim();
  if (!name) {
    const trimmed = text.trim();
    return { before: trimmed, after: '' };
  }
  const idx = text.indexOf(name);
  if (idx < 0) {
    const trimmed = text.trim();
    return { before: trimmed, after: '' };
  }
  return {
    before: text.slice(0, idx).trim(),
    after: text.slice(idx + name.length).trim(),
  };
}

async function materializeDefaultSessionForWorkflowShortcut(): Promise<{
  sessionKey: string;
  agentId: string;
}> {
  const state = useChatStore.getState();
  if (state.currentSessionKey === DEFAULT_SESSION_KEY) {
    state.newSession(
      state.pendingProjectId
        ? { projectId: state.pendingProjectId, materialize: true }
        : undefined,
    );
  }

  const nextState = useChatStore.getState();
  await awaitSessionSendReadiness(nextState.currentSessionKey);
  return {
    sessionKey: nextState.currentSessionKey,
    agentId: nextState.currentAgentId,
  };
}

export async function dispatchChatSend(options: DispatchChatSendOptions): Promise<void> {
  const {
    text,
    attachments,
    targetAgentId,
    dingTalkMentions,
    workflowId,
    workflowSource,
    workflowName,
    skillMeta,
  } = options;

  const sendMessage = useChatStore.getState().sendMessage;

  const sendWithWorkflowContext = async (
    textToSend: string,
    _runId?: string | null,
    wfId?: string | null,
    ctx?: unknown,
  ) => {
    await sendMessage({
      text: textToSend,
      attachments,
      targetAgentId,
      dingTalkMentions,
      workflowId: wfId || undefined,
      runId: _runId || undefined,
      workflowContext: ctx as import('@/stores/chat').WorkflowContextBlock | undefined,
      skillMeta,
    });
  };

  const chatState = useChatStore.getState();
  const failed = () => Boolean(
    useChatRuntimeV2Store.getState().sessionsByKey[useChatStore.getState().currentSessionKey]?.error,
  );

  // 我的工作流-已发布：与「我的工作流」卡片「立即运行」保持一致，
  // 直接发送一句「帮我执行 id 为：xxx 的工作流 【名称】」让模型按 workflowId 执行，
  // 不走模版 schema 取数与参数表单，也不注入额外上下文。
  // 用户在标签前/后的文案按原顺序拼在执行指令两侧，供气泡还原展示。
  if (workflowId && workflowSource === 'mine') {
    chatState.clearPendingWorkflow();
    const name = workflowName?.trim() || '';
    const { before, after } = extractWorkflowSurroundingText(text, name);
    const label = name || workflowId;
    const execText = `帮我执行 id 为：${workflowId} 的工作流 【${label}】`;
    const messageText = [before, execText, after].filter(Boolean).join(' ');
    await sendMessage({
      text: messageText,
      attachments,
      targetAgentId,
      dingTalkMentions,
    });
    if (failed()) {
      toast.error('发送失败，请重试');
    }
    return;
  }

  // Explicit template pick from picker — fetch schema → send to model.
  if (workflowId) {
    const workflowSession = await materializeDefaultSessionForWorkflowShortcut();
    const workflowChatState = useChatStore.getState();
    if (
      workflowChatState.workflowChatUiBySessionKey[workflowSession.sessionKey]
        ?.pendingWorkflow?.templateId !== workflowId
    ) {
      workflowChatState.clearPendingWorkflow();
    }
    const { sendWithWorkflow } = await import('@/hooks/use-workflow-send');
    const ok = await sendWithWorkflow(text, workflowId, {
      sessionKey: workflowSession.sessionKey,
      agentId: workflowSession.agentId,
    }, sendWithWorkflowContext, dingTalkMentions);
    if (!ok) return;
    return;
  }

  // Re-run / start remembered workflow without waiting for model execute_workflow.
  const { tryStartRememberedWorkflowSend, tryResolvePendingWorkflow } = await import(
    '@/hooks/use-workflow-send'
  );

  // Skill sends preserve their metadata and bypass workflow-intent routing.
  if (skillMeta) {
    await sendMessage({ text, attachments, targetAgentId, dingTalkMentions, skillMeta });
    if (failed()) {
      toast.error('发送失败，请重试');
    }
    return;
  }

  const startedRemembered = await tryStartRememberedWorkflowSend({
    text,
    context: {
      sessionKey: chatState.currentSessionKey,
      agentId: chatState.currentAgentId,
    },
    sendMessage: async (msg, runId, wfId) => {
      await sendMessage({
        text: msg,
        attachments,
        targetAgentId,
        dingTalkMentions,
        workflowId: wfId ?? undefined,
        runId: runId ?? undefined,
        skillMeta,
      });
    },
  });
  if (startedRemembered) return;

  // In-flight parameter_form confirm / cancel only — creation & search go through model tools.
  const resolved = await tryResolvePendingWorkflow(text, async (msg, runId, wfId) => {
    await sendMessage({ text: msg, attachments, targetAgentId, dingTalkMentions, workflowId: wfId, runId, skillMeta });
  });
  if (resolved) return;

  await sendMessage({ text, attachments, targetAgentId, dingTalkMentions, skillMeta });
  if (failed()) {
    toast.error('发送失败，请重试');
  }
}
