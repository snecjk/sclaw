import {
  selectHighestQwenPlusModel,
  upsertSessionModel,
} from '@/lib/chat-model-options';
import {
  persistSessionModelToGateway,
  resolveModelToPersistForSession,
} from '@/lib/sync-workspace-default-to-chat';
import { useChatStore } from '@/stores/chat';
import { useProviderStore } from '@/stores/providers';

/**
 * Workflow chat runs always use Claude Agent. Prefer the highest visible
 * qwen3.x-plus catalog model; otherwise keep the session's normal fallback.
 */
export async function configureWorkflowRunSession(input: {
  sessionKey: string;
  agentId: string;
}): Promise<string> {
  const sessionKey = input.sessionKey.trim();
  if (!sessionKey) throw new Error('缺少会话标识，无法启动工作流');

  const { accounts } = useProviderStore.getState();
  const qwenPlus = selectHighestQwenPlusModel(accounts);
  const fallback = qwenPlus ?? resolveModelToPersistForSession({
    sessionKey,
    agentId: input.agentId,
    engineType: 'claude',
  });
  if (!fallback) throw new Error('未找到可用模型，无法启动工作流');

  const persisted = await persistSessionModelToGateway({
    sessionKey,
    model: fallback.modelId,
    accountId: fallback.accountId,
    agentId: input.agentId,
    engineType: 'claude',
  });

  useChatStore.setState((state) => ({
    sessions: upsertSessionModel(state.sessions, sessionKey, persisted, {
      engineType: 'claude',
      agentId: input.agentId,
    }),
  }));
  return persisted;
}
