import type { RawMessage } from '@/stores/chat';
import {
  getAgentPreparationStage,
  isAgentPreparationProgressMessage,
  type AgentPreparationStage,
} from '@/lib/agent-preparation-progress';

export function isSkillRoutingProgressMessage(message: RawMessage | null | undefined): boolean {
  return getAgentPreparationStage(message) === 'skill';
}

export function findLatestSkillRoutingProgressMessage(
  messages: Array<RawMessage | null | undefined>,
): RawMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isSkillRoutingProgressMessage(message)) return message ?? null;
  }
  return null;
}

export { isAgentPreparationProgressMessage };

export function findLatestAgentPreparationProgressMessage(
  messages: Array<RawMessage | null | undefined>,
  stage: AgentPreparationStage,
): RawMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (getAgentPreparationStage(message) === stage) return message ?? null;
  }
  return null;
}
