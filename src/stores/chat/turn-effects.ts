import { finalizeMessagesFromHistoryLoad } from './history-finalization';
import type { ChatGet, ChatSet } from './store-api';
import type { ChatSession } from './types';

export type TurnEffect =
  | {
      type: 'captureMemory';
      agentId?: string | null;
      runId?: string | null;
      sessionKey?: string | null;
      engineType?: ChatSession['engineType'];
    }
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
  dispatchMemoryCapture: (input: {
    agentId?: string | null;
    runId?: string | null;
    sessionKey?: string | null;
    engineType?: ChatSession['engineType'];
  }) => void;
}

export function executeTurnEffects(
  effects: TurnEffect[],
  executor: TurnEffectExecutor,
): void {
  for (const effect of effects) {
    if (effect.type === 'captureMemory') {
      executor.dispatchMemoryCapture({
        agentId: effect.agentId,
        runId: effect.runId,
        sessionKey: effect.sessionKey,
        engineType: effect.engineType,
      });
      continue;
    }

    if (effect.type === 'reloadHistoryAndFinalize') {
      executor.clearHistoryPoll?.();
      void executor.get().loadHistory(true, true).then(() => {
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
  const effects: TurnEffect[] = [{
    type: 'captureMemory',
    agentId: input.agentId,
    runId: input.runId,
    sessionKey: input.sessionKey,
    engineType: input.engineType,
  }];

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
