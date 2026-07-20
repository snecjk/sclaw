import { finalizeMessagesFromHistoryLoad } from './history-finalization';
import type { ChatGet, ChatSet } from './store-api';
import type { ChatSession } from './types';

export type TurnEffect =
  | {
      type: 'reloadHistoryAndFinalize';
      agentId?: string | null;
      runId?: string | null;
      sessionKey: string;
    }
  | {
      type: 'finalizeVisibleMessages';
      agentId?: string | null;
      runId?: string | null;
      sessionKey: string;
    };

export interface TurnEffectExecutor {
  get: ChatGet;
  set: ChatSet;
  clearHistoryPoll?: () => void;
}

export function executeTurnEffects(
  effects: TurnEffect[],
  executor: TurnEffectExecutor,
): void {
  for (const effect of effects) {
    if (effect.type === 'reloadHistoryAndFinalize') {
      executor.clearHistoryPoll?.();
      void executor.get().loadHistory(true, true, effect.sessionKey).then(() => {
        if (executor.get().currentSessionKey !== effect.sessionKey) return;
        finalizeMessagesFromHistoryLoad(executor.get, executor.set, {
          agentId: effect.agentId,
          runId: effect.runId,
          sessionKey: effect.sessionKey,
        });
      });
      continue;
    }

    finalizeMessagesFromHistoryLoad(executor.get, executor.set, {
      agentId: effect.agentId,
      runId: effect.runId,
      sessionKey: effect.sessionKey,
    });
  }
}

export function buildTerminalTurnEffects(input: {
  agentId?: string | null;
  runId?: string | null;
  sessionKey: string;
  engineType?: ChatSession['engineType'];
  reloadHistory?: boolean;
  finalizeVisibleMessages?: boolean;
}): TurnEffect[] {
  const effects: TurnEffect[] = [];

  if (input.reloadHistory) {
    effects.push({
      type: 'reloadHistoryAndFinalize',
      agentId: input.agentId,
      runId: input.runId,
      sessionKey: input.sessionKey,
    });
  } else if (input.finalizeVisibleMessages) {
    effects.push({
      type: 'finalizeVisibleMessages',
      agentId: input.agentId,
      runId: input.runId,
      sessionKey: input.sessionKey,
    });
  }

  return effects;
}
