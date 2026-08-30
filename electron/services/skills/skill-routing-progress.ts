import { toLegacyChatMessagePayload } from '../../gateway/normalized-engine-event';

export type SkillRoutingProgressSink = {
  emit(event: string, payload: unknown): unknown;
};

export function emitSkillRoutingProgress(
  sink: SkillRoutingProgressSink | null | undefined,
  sessionKey: string,
  runId: string,
  text: string,
): void {
  if (!sink) return;
  sink.emit('chat:message', toLegacyChatMessagePayload({
    type: 'message.delta',
    sessionKey,
    runId,
    message: {
      id: `skill-routing-${runId}`,
      role: 'assistant',
      content: [{ type: 'text', text }],
      metadata: { kind: 'skill-routing-progress' },
    },
  }));
}
