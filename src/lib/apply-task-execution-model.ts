import { upsertSessionModel } from '@/lib/chat-model-options';
import { useChatStore } from '@/stores/chat';

/** Apply trigger API executionModel/agentId onto the chat session list before switchSession. */
export function applyTaskExecutionModelToChatSession(opts: {
  sessionKey: string;
  model?: string | null;
  agentId?: string | null;
  engineType?: 'openclaw' | 'claude';
}): void {
  const sessionKey = opts.sessionKey.trim();
  const model = opts.model?.trim();
  if (!sessionKey || !model) return;

  useChatStore.setState((state) => ({
    sessions: upsertSessionModel(
      state.sessions,
      sessionKey,
      model,
      {
        engineType: opts.engineType,
        agentId: opts.agentId?.trim() || undefined,
      },
    ),
  }));
}
