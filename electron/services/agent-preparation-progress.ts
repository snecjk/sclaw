import { toLegacyChatMessagePayload } from '../gateway/normalized-engine-event';

const AGENT_PREPARATION_PROGRESS_KIND = 'agent-preparation-progress';
type AgentPreparationStage = 'skill' | 'memory';
type AgentPreparationStatus = 'running' | 'completed';

export type AgentPreparationProgressSink = {
  emit(event: string, payload: unknown): unknown;
};

export function emitAgentPreparationProgress(
  sink: AgentPreparationProgressSink | null | undefined,
  sessionKey: string,
  identity: string,
  stage: AgentPreparationStage,
  status: AgentPreparationStatus,
  text: string,
  runId?: string,
  details?: Record<string, unknown>,
): void {
  if (!sink || typeof sink.emit !== 'function') return;
  sink.emit('chat:message', toLegacyChatMessagePayload({
    type: 'message.delta',
    sessionKey,
    ...(runId ? { runId } : {}),
    message: {
      id: `agent-preparation-${stage}-${identity}`,
      role: 'assistant',
      content: [{ type: 'text', text }],
      metadata: {
        kind: AGENT_PREPARATION_PROGRESS_KIND,
        stage,
        status,
        ...details,
      },
    },
  }));
}
