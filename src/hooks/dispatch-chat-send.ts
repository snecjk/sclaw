/**
 * Unified chat send dispatcher: workflow UI shortcuts then normal chat (model + builtin tools).
 * Used by Chat page and Home hub so behavior stays consistent.
 */
import { toast } from 'sonner';
import { useChatStore } from '@/stores/chat';
import { awaitSessionSendReadiness } from '@/lib/session-send-readiness';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';
import type { FileAttachment } from '@/pages/Chat/ChatInput';
import type { PersistedComposerSegment } from '@/lib/dingtalk-mention-composer';
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
  skillMetas?: SkillMeta[];
  workflows?: Array<{ id: string; name: string; source?: string }>;
  composerSegments?: PersistedComposerSegment[];
  gatewayText?: string;
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
    skillMetas,
    workflows,
    composerSegments,
    gatewayText,
  } = options;

  const sendMessage = useChatStore.getState().sendMessage;
  const resolvedSkillMetas = skillMetas ?? (skillMeta ? [skillMeta] : []);
  const resolvedWorkflows = workflows ?? (
    workflowId
      ? [{
        id: workflowId,
        name: workflowName?.trim() || workflowId,
        source: workflowSource ?? undefined,
      }]
      : []
  );

  const sendWithWorkflowContext = async (
    textToSend: string,
    _runId?: string | null,
    wfId?: string | null,
    ctx?: unknown,
  ) => {
    await sendMessage({
      text: textToSend,
      gatewayText,
      attachments,
      targetAgentId,
      dingTalkMentions,
      workflowId: wfId || undefined,
      runId: _runId || undefined,
      workflowContext: ctx as import('@/stores/chat').WorkflowContextBlock | undefined,
      skillMeta: resolvedSkillMetas[0],
      skillMetas: resolvedSkillMetas.length ? resolvedSkillMetas : undefined,
      workflows: resolvedWorkflows.length ? resolvedWorkflows : undefined,
      composerSegments,
    });
  };

  const chatState = useChatStore.getState();
  const failed = () => Boolean(
    useChatRuntimeV2Store.getState().sessionsByKey[useChatStore.getState().currentSessionKey]?.error,
  );

  const nonMineWorkflows = resolvedWorkflows.filter((wf) => wf.source !== 'mine');
  const hasMineWorkflow = resolvedWorkflows.some((wf) => wf.source === 'mine');
  const useTemplateWorkflowPath = !gatewayText
    && resolvedSkillMetas.length === 0
    && nonMineWorkflows.length === 1
    && !hasMineWorkflow;

  if (useTemplateWorkflowPath) {
    const templateWorkflow = nonMineWorkflows[0];
    const workflowSession = await materializeDefaultSessionForWorkflowShortcut();
    const workflowChatState = useChatStore.getState();
    if (
      workflowChatState.workflowChatUiBySessionKey[workflowSession.sessionKey]
        ?.pendingWorkflow?.templateId !== templateWorkflow.id
    ) {
      workflowChatState.clearPendingWorkflow();
    }
    const { sendWithWorkflow } = await import('@/hooks/use-workflow-send');
    const ok = await sendWithWorkflow(text, templateWorkflow.id, {
      sessionKey: workflowSession.sessionKey,
      agentId: workflowSession.agentId,
    }, sendWithWorkflowContext, dingTalkMentions);
    if (!ok) return;
    return;
  }

  const hasSegmentBake = Boolean(
    gatewayText
    || resolvedSkillMetas.length > 0
    || resolvedWorkflows.length > 0
    || composerSegments?.length,
  );

  if (hasSegmentBake) {
    chatState.clearPendingWorkflow();
    await sendMessage({
      text,
      gatewayText,
      attachments,
      targetAgentId,
      dingTalkMentions,
      skillMeta: resolvedSkillMetas[0],
      skillMetas: resolvedSkillMetas.length ? resolvedSkillMetas : undefined,
      workflows: resolvedWorkflows.length ? resolvedWorkflows : undefined,
      composerSegments,
    });
    if (failed()) {
      toast.error('发送失败，请重试');
    }
    return;
  }

  const { tryStartRememberedWorkflowSend, tryResolvePendingWorkflow } = await import(
    '@/hooks/use-workflow-send'
  );

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
        skillMeta: resolvedSkillMetas[0],
      });
    },
  });
  if (startedRemembered) return;

  const resolved = await tryResolvePendingWorkflow(text, async (msg, runId, wfId) => {
    await sendMessage({
      text: msg,
      attachments,
      targetAgentId,
      dingTalkMentions,
      workflowId: wfId,
      runId,
      skillMeta: resolvedSkillMetas[0],
    });
  });
  if (resolved) return;

  await sendMessage({
    text,
    attachments,
    targetAgentId,
    dingTalkMentions,
    skillMeta: resolvedSkillMetas[0],
  });
  if (failed()) {
    toast.error('发送失败，请重试');
  }
}
