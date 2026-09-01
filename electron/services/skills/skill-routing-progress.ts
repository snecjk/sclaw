import { emitAgentPreparationProgress } from '../agent-preparation-progress';

export type SkillRoutingProgressSink = {
  emit(event: string, payload: unknown): unknown;
};

export function emitSkillRoutingProgress(
  sink: SkillRoutingProgressSink | null | undefined,
  sessionKey: string,
  runId: string,
  text: string,
): void {
  const completed = /^(?:已匹配技能|未匹配到相关技能|未找到匹配技能)/.test(text);
  emitAgentPreparationProgress(
    sink,
    sessionKey,
    runId,
    'skill',
    completed ? 'completed' : 'running',
    text,
    runId,
  );
}
