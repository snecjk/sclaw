import { BrowserWindow } from 'electron';

import {
  extractClaudeResultUsage,
  type TurnTokenUsage,
} from '../../shared/turn-token';
import { getTurnTokenService } from './turn-token-service';
import { logger } from '../utils/logger';

function broadcastTurnTokenUpdated(usage: TurnTokenUsage): void {
  const payload = {
    sessionKey: usage.sessionKey,
    turnIndex: usage.turnIndex,
    usage,
  };
  try {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.send('turn-token:updated', payload);
    }
  } catch (error) {
    logger.debug('[turn-token] broadcast skipped:', error);
  }
}

export function captureClaudeTurnTokenUsage(input: {
  sessionKey: string;
  resultMessage: unknown;
  model?: string;
  emittedAt?: string;
}): TurnTokenUsage | null {
  const normalized = extractClaudeResultUsage(input.resultMessage);
  if (!normalized) return null;

  const turnIndex = getTurnTokenService().allocateTurnIndex(input.sessionKey);
  const usage = getTurnTokenService().record({
    engineType: 'claude',
    sessionKey: input.sessionKey,
    turnIndex,
    promptTokens: normalized.promptTokens,
    completionTokens: normalized.completionTokens,
    totalTokens: normalized.totalTokens,
    model: input.model,
    emittedAt: input.emittedAt,
  });
  if (!usage) return null;

  broadcastTurnTokenUpdated(usage);
  return usage;
}
