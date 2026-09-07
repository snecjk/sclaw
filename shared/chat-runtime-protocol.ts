export const CHAT_RUNTIME_PROTOCOL_VERSION = 1 as const;

import type { AgentEngineType } from './agent-engine';

export type ChatEngineType = AgentEngineType;

export interface ChatRuntimePolicy {
  origin: 'interactive' | 'scheduled_task' | 'channel' | 'bridge';
  ownerId?: string;
  deadlineAt?: number | null;
}

export type ChatRunPhase =
  | 'dispatching'
  | 'uncertain'
  | 'running'
  | 'awaiting_transcript'
  | 'aborting'
  | 'reconciling'
  | 'completed'
  | 'failed'
  | 'aborted'
  | 'interrupted';

export type ContextCompactionReason = 'manual' | 'threshold' | 'overflow' | 'auto' | 'unknown';

export interface ContextCompactionActivity {
  type: 'context_compaction';
  attemptId: string;
  status: 'running' | 'retrying';
  reason: ContextCompactionReason;
  startedAt: number;
}

export interface ChatContextUsage {
  tokens: number | null;
  contextWindow: number | null;
  percent: number | null;
  accuracy: 'exact' | 'estimated' | 'unknown';
  updatedAt: number;
}

export type CanonicalChatEventType =
  | 'run.dispatching'
  | 'run.accepted'
  | 'run.started'
  | 'message.delta'
  | 'message.final'
  | 'tool.updated'
  | 'context.compaction.started'
  | 'context.compaction.completed'
  | 'context.compaction.failed'
  | 'context.usage.updated'
  | 'transcript.updated'
  | 'run.awaiting_transcript'
  | 'run.completed'
  | 'run.failed'
  | 'run.aborted'
  | 'run.interrupted';

export interface CanonicalChatEvent {
  protocolVersion: typeof CHAT_RUNTIME_PROTOCOL_VERSION;
  eventId: string;
  sessionKey: string;
  runId: string | null;
  idempotencyKey?: string;
  runtimePolicy?: ChatRuntimePolicy;
  engineType: ChatEngineType;
  epoch: number;
  sequence: number;
  occurredAt: number;
  type: CanonicalChatEventType;
  payload?: unknown;
}

export interface ChatRuntimeSnapshot {
  protocolVersion: typeof CHAT_RUNTIME_PROTOCOL_VERSION;
  sessionKey: string;
  runId: string | null;
  idempotencyKey: string | null;
  runtimePolicy: ChatRuntimePolicy;
  engineType: ChatEngineType;
  phase: ChatRunPhase;
  epoch: number;
  sequence: number;
  startedAt: number;
  lastEventAt: number;
  terminalAt: number | null;
  error: string | null;
  /** Transient engine activity inside the current run; it does not change run phase. */
  activity?: ContextCompactionActivity | null;
  /** Most recent engine-reported context occupancy for this session. */
  contextUsage?: ChatContextUsage | null;
  acceptanceResult: unknown | null;
  updatedAt: number;
}

export const TERMINAL_CHAT_RUN_PHASES: ReadonlySet<ChatRunPhase> = new Set([
  'completed',
  'failed',
  'aborted',
  'interrupted',
]);

export function isTerminalChatRunPhase(phase: ChatRunPhase): boolean {
  return TERMINAL_CHAT_RUN_PHASES.has(phase);
}
