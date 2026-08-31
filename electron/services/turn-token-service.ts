import type { TurnEngineType, TurnTokenUsage } from '../../shared/turn-token';

type TurnTokenKey = `${string}#${number}`;

function buildKey(sessionKey: string, turnIndex: number): TurnTokenKey {
  return `${sessionKey}#${turnIndex}`;
}

class TurnTokenService {
  private readonly byKey = new Map<TurnTokenKey, TurnTokenUsage>();
  /** Claude：按会话单调递增，与 UI turnIndex 对齐。 */
  private readonly allocatedTurnIndex = new Map<string, number>();

  allocateTurnIndex(sessionKey: string): number {
    const normalized = sessionKey.trim();
    if (!normalized) return 0;
    const next = this.allocatedTurnIndex.get(normalized) ?? 0;
    this.allocatedTurnIndex.set(normalized, next + 1);
    return next;
  }

  record(input: {
    engineType: TurnEngineType;
    sessionKey: string;
    turnIndex: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    model?: string;
    emittedAt?: string;
  }): TurnTokenUsage | null {
    const sessionKey = input.sessionKey.trim();
    if (!sessionKey) return null;

    const promptTokens = Math.max(0, input.promptTokens);
    const completionTokens = Math.max(0, input.completionTokens);
    const totalTokens = Math.max(0, input.totalTokens || promptTokens + completionTokens);
    if (promptTokens <= 0 && completionTokens <= 0 && totalTokens <= 0) {
      return null;
    }

    const usage: TurnTokenUsage = {
      engineType: input.engineType,
      sessionKey,
      turnIndex: Math.max(0, input.turnIndex),
      promptTokens,
      completionTokens,
      totalTokens,
      model: input.model,
      emittedAt: input.emittedAt ?? new Date().toISOString(),
    };
    this.byKey.set(buildKey(sessionKey, usage.turnIndex), usage);
    return usage;
  }

  get(sessionKey: string, turnIndex: number): TurnTokenUsage | null {
    return this.byKey.get(buildKey(sessionKey, turnIndex)) ?? null;
  }

  clearSession(sessionKey: string): void {
    const normalized = sessionKey.trim();
    const prefix = `${normalized}#`;
    for (const key of this.byKey.keys()) {
      if (key.startsWith(prefix)) {
        this.byKey.delete(key);
      }
    }
    this.allocatedTurnIndex.delete(normalized);
  }
}

let instance: TurnTokenService | null = null;

export function getTurnTokenService(): TurnTokenService {
  if (!instance) {
    instance = new TurnTokenService();
  }
  return instance;
}

export type { TurnTokenService };
