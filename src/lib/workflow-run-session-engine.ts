import { upsertSessionModel } from '@/lib/chat-model-options';
import {
  persistSessionModelToGateway,
  resolveModelToPersistForSession,
} from '@/lib/sync-workspace-default-to-chat';
import { awaitSessionSendReadiness } from '@/lib/session-send-readiness';
import { useChatStore } from '@/stores/chat';

/**
 * The selected workflow engine is persisted onto the navigation-created chat
 * session so the eventual local run uses the same engine choice.
 */
export async function configureWorkflowRunSession(input: {
  sessionKey: string;
  agentId: string;
  engineType: 'claude' | 'openclaw';
}): Promise<string> {
  const sessionKey = input.sessionKey.trim();
  if (!sessionKey) throw new Error('缺少会话标识，无法启动工作流');

  // `newSession()` immediately starts an OpenClaw/default-model persistence
  // task. Wait for it before writing the workflow override; otherwise that
  // earlier async task may finish last and switch this new workflow chat back
  // to the default engine/model.
  await awaitSessionSendReadiness(sessionKey);

  const fallback = resolveModelToPersistForSession({
    sessionKey,
    agentId: input.agentId,
    engineType: input.engineType,
    // `newSession()` can inherit the previous conversation's model before this
    // selected engine is applied. For OpenClaw that value may be a Claude model
    // (for example Sonnet), so use the chat workspace default instead.
    preferSessionModel: input.engineType !== 'openclaw',
    preferPendingModel: input.engineType !== 'openclaw',
  });
  if (!fallback) throw new Error('未找到可用模型，无法启动工作流');

  const persisted = await persistSessionModelToGateway({
    sessionKey,
    model: fallback.modelId,
    accountId: fallback.accountId,
    agentId: input.agentId,
    engineType: input.engineType,
  });

  useChatStore.setState((state) => ({
    sessions: upsertSessionModel(state.sessions, sessionKey, persisted, {
      engineType: input.engineType,
      agentId: input.agentId,
    }),
  }));
  return persisted;
}
