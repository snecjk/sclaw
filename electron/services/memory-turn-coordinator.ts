import type { GatewayManager } from '../gateway/manager';
import type { AgentEngineType } from '../engines/types';
import { memoryCaptureService } from './memory-capture-service';
import type { InjectedExecutionMemory } from '../../shared/agent-memory-prompt';

type TerminalStatus = 'completed' | 'failed' | 'aborted';
type PendingTurn = {
  sessionKey: string;
  idempotencyKey: string;
  agentId: string;
  engineType: AgentEngineType;
  memories: InjectedExecutionMemory[];
  runId?: string;
  terminalStatus?: TerminalStatus;
  createdAt: number;
};

const TURN_TTL_MS = 20 * 60 * 1000;
const MAX_TURNS = 100;

function agentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  return sessionKey.split(':')[1]?.trim().toLowerCase() || 'main';
}

export class MemoryTurnCoordinator {
  private pendingByKey = new Map<string, PendingTurn>();
  private turnsByRunId = new Map<string, PendingTurn>();
  private terminalRuns = new Map<string, number>();

  constructor(private gatewayManager: GatewayManager) {}

  begin(input: {
    sessionKey: string;
    idempotencyKey: string;
    engineType: AgentEngineType;
    memories: InjectedExecutionMemory[];
  }): void {
    this.prune();
    const turn: PendingTurn = {
      ...input,
      agentId: agentIdFromSessionKey(input.sessionKey),
      createdAt: Date.now(),
    };
    this.pendingByKey.set(this.pendingKey(input.sessionKey, input.idempotencyKey), turn);
  }

  async bind(input: { sessionKey: string; idempotencyKey: string; runId?: string }): Promise<void> {
    const key = this.pendingKey(input.sessionKey, input.idempotencyKey);
    const turn = this.pendingByKey.get(key);
    const runId = input.runId?.trim();
    if (!turn || !runId) return;
    turn.runId = runId;
    this.turnsByRunId.set(runId, turn);
    memoryCaptureService.bindInjectedExecutionMemories({ runId, memories: turn.memories });
    if (turn.terminalStatus) await this.finalize(turn, turn.terminalStatus);
  }

  reject(sessionKey: string, idempotencyKey: string): void {
    this.pendingByKey.delete(this.pendingKey(sessionKey, idempotencyKey));
  }

  async completed(sessionKey?: string | null, runId?: string | null): Promise<void> {
    await this.handleTerminal('completed', sessionKey, runId);
  }

  async failed(sessionKey?: string | null, runId?: string | null): Promise<void> {
    await this.handleTerminal('failed', sessionKey, runId);
  }

  async aborted(sessionKey?: string | null, runId?: string | null): Promise<void> {
    await this.handleTerminal('aborted', sessionKey, runId);
  }

  private async handleTerminal(status: TerminalStatus, sessionKey?: string | null, runIdValue?: string | null): Promise<void> {
    this.prune();
    const runId = runIdValue?.trim();
    if (runId && this.terminalRuns.has(runId)) return;
    let turn = runId ? this.turnsByRunId.get(runId) : undefined;
    if (!turn && sessionKey) {
      const candidates = [...this.pendingByKey.values()]
        .filter((item) => item.sessionKey === sessionKey)
        .sort((a, b) => b.createdAt - a.createdAt);
      turn = candidates[0];
    }
    if (!turn) return;
    if (!turn.runId && runId) {
      turn.runId = runId;
      this.turnsByRunId.set(runId, turn);
      memoryCaptureService.bindInjectedExecutionMemories({ runId, memories: turn.memories });
    }
    if (!turn.runId) {
      turn.terminalStatus = status;
      return;
    }
    if (runId && turn.runId !== runId) return;
    await this.finalize(turn, status);
  }

  private async finalize(turn: PendingTurn, status: TerminalStatus): Promise<void> {
    const runId = turn.runId;
    if (!runId || this.terminalRuns.has(runId)) return;
    this.terminalRuns.set(runId, Date.now());
    this.turnsByRunId.delete(runId);
    this.pendingByKey.delete(this.pendingKey(turn.sessionKey, turn.idempotencyKey));
    if (status !== 'completed') {
      memoryCaptureService.discardInjectedExecutionMemories(runId);
      return;
    }
    await memoryCaptureService.capture({
      runId,
      sessionKey: turn.sessionKey,
      agentId: turn.agentId,
      engineType: turn.engineType,
      terminalStatus: 'completed',
    }, this.gatewayManager);
  }

  private pendingKey(sessionKey: string, idempotencyKey: string): string {
    return `${sessionKey}\u0000${idempotencyKey}`;
  }

  private prune(): void {
    const cutoff = Date.now() - TURN_TTL_MS;
    for (const [key, turn] of this.pendingByKey) if (turn.createdAt < cutoff) this.pendingByKey.delete(key);
    for (const [runId, turn] of this.turnsByRunId) {
      if (turn.createdAt < cutoff) {
        this.turnsByRunId.delete(runId);
        memoryCaptureService.discardInjectedExecutionMemories(runId);
      }
    }
    for (const [runId, createdAt] of this.terminalRuns) if (createdAt < cutoff) this.terminalRuns.delete(runId);
    while (this.pendingByKey.size > MAX_TURNS) this.pendingByKey.delete(this.pendingByKey.keys().next().value as string);
    while (this.turnsByRunId.size > MAX_TURNS) this.turnsByRunId.delete(this.turnsByRunId.keys().next().value as string);
    while (this.terminalRuns.size > MAX_TURNS) this.terminalRuns.delete(this.terminalRuns.keys().next().value as string);
  }
}

const coordinators = new WeakMap<GatewayManager, MemoryTurnCoordinator>();
export function getMemoryTurnCoordinator(gatewayManager: GatewayManager): MemoryTurnCoordinator {
  let coordinator = coordinators.get(gatewayManager);
  if (!coordinator) {
    coordinator = new MemoryTurnCoordinator(gatewayManager);
    coordinators.set(gatewayManager, coordinator);
  }
  return coordinator;
}
