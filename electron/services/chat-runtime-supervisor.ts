import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { GatewayManager } from '../gateway/manager';
import type { NormalizedEngineEvent } from '../gateway/normalized-engine-event';
import { getAdapterForSession } from '../engines/manager';
import type { AgentEngineType } from '../engines/types';
import { getChatRuntimeRepository } from '../db/repositories/chat-runtime-repository';
import {
  CHAT_RUNTIME_PROTOCOL_VERSION,
  type CanonicalChatEvent,
  type CanonicalChatEventType,
  type ChatRuntimeSnapshot,
  type ChatRuntimePolicy,
  isTerminalChatRunPhase,
} from '../../shared/chat-runtime-protocol';
import { logger } from '../utils/logger';
import { isWorkflowOpenClawSessionKey } from '../../shared/workflow-openclaw-session';
import { patchTerminalRuntimeMetadata, transitionChatRuntime, transitionChatRuntimePhase } from './chat-runtime-transition';
import { inspectTranscript } from '../engines/chat-runtime-inspection';

const RECOVERY_DEADLINE_MS = 135_000;
const RECOVERY_RETRY_MS = 5_000;
const DELTA_PERSIST_THROTTLE_MS = 1_000;
const ERROR_RECOVERY_GRACE_MS = 15_000;
const RUN_HARD_DEADLINE_MS = 6 * 60 * 60_000;
const HISTORY_POLL_START_DELAY_MS = 1_000;
const HISTORY_POLL_BACKOFF_MS = [2_000, 4_000, 8_000] as const;
const TRANSCRIPT_COMPENSATION_DELAYS_MS = [1_000, 3_000, 7_000] as const;
const IDEMPOTENCY_REPLAY_WINDOW_MS = 10 * 60_000;

interface ChatDispatchPayload {
  idempotencyKey: string;
  optimisticUserMessage?: {
    id: string;
    role: 'user';
    content: string;
    timestamp: number;
  };
}

export type BeginRuntimeResult =
  | { kind: 'created'; snapshot: ChatRuntimeSnapshot }
  | { kind: 'replay'; snapshot: ChatRuntimeSnapshot }
  | { kind: 'expired_key'; snapshot: ChatRuntimeSnapshot }
  | { kind: 'unavailable'; error: string };

function normalizeRuntimePolicy(
  policy: ChatRuntimePolicy | undefined,
  startedAt: number,
): ChatRuntimePolicy {
  return {
    origin: policy?.origin ?? 'interactive',
    ownerId: policy?.ownerId,
    deadlineAt: policy?.deadlineAt === undefined ? startedAt + RUN_HARD_DEADLINE_MS : policy.deadlineAt,
  };
}

type SupervisorEventMap = {
  event: [CanonicalChatEvent];
};

function inferEngineType(sessionKey: string): AgentEngineType {
  return sessionKey.startsWith('claude:') || sessionKey.startsWith('claude-task:')
    ? 'claude'
    : 'openclaw';
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function messageOccurredAt(message: Record<string, unknown> | null): number {
  if (!message) return 0;
  const raw = message.timestamp ?? message.createdAt ?? message.created_at;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw < 1_000_000_000_000 ? raw * 1_000 : raw;
  }
  if (typeof raw === 'string') {
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric;
    }
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function currentRunTranscriptMessages(snapshot: ChatRuntimeSnapshot, messages: unknown[]): unknown[] {
  const idempotencyKey = snapshot.idempotencyKey?.trim();
  if (idempotencyKey) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = getRecord(messages[index]);
      if (String(message?.role ?? '').toLowerCase() !== 'user') continue;
      const metadata = getRecord(message?.metadata);
      const messageKey = message?.idempotencyKey ?? message?.idempotency_key
        ?? metadata?.idempotencyKey ?? metadata?.idempotency_key;
      if (messageKey === idempotencyKey) return messages.slice(index + 1);
    }
  }
  let currentUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = getRecord(messages[index]);
    if (String(message?.role ?? '').toLowerCase() !== 'user') continue;
    const occurredAt = messageOccurredAt(message);
    // Legacy transcripts do not carry idempotency metadata. Allow clock skew, but
    // never project a clearly older turn into the current run.
    if (occurredAt > 0 && occurredAt < snapshot.startedAt - 60_000) return [];
    currentUserIndex = index;
    break;
  }
  return currentUserIndex < 0 ? [] : messages.slice(currentUserIndex + 1);
}

function transcriptMessageFingerprint(message: Record<string, unknown>, index: number): string {
  const identity = message.id ?? message.messageId ?? message.toolCallId ?? message.tool_call_id ?? index;
  const role = String(message.role ?? '');
  const content = message.content ?? message.text ?? '';
  const blocks = Array.isArray(content) ? content : [];
  const text = typeof content === 'string'
    ? content
    : blocks.map((block) => String(getRecord(block)?.text ?? '')).join('');
  const toolStatus = String(message.status ?? message.state ?? message.phase ?? '');
  const toolRevision = String(message.revision ?? message.updatedAt ?? message.updated_at ?? '');
  const toolOutput = message.result ?? message.output ?? message.toolResult ?? '';
  const outputLength = typeof toolOutput === 'string'
    ? toolOutput.length
    : Array.isArray(toolOutput) ? toolOutput.length : toolOutput && typeof toolOutput === 'object' ? Object.keys(toolOutput).length : 0;
  return [identity, role, text.length, blocks.length, toolStatus, toolRevision, outputLength].join('\u0000');
}

interface RunDiagnostics {
  polls: number;
  transcriptRevisions: number;
  canonicalEvents: number;
  databaseWrites: number;
}

function eventTypeForEngineEvent(event: NormalizedEngineEvent): CanonicalChatEventType {
  switch (event.type) {
    case 'turn.started': return 'run.started';
    case 'message.delta': return 'message.delta';
    case 'message.final': return 'message.final';
    case 'tool.result': return 'tool.updated';
    case 'turn.completed': return 'run.completed';
    case 'turn.failed': return 'run.failed';
    case 'turn.aborted': return 'run.aborted';
  }
}

export class ChatRuntimeSupervisor extends EventEmitter<SupervisorEventMap> {
  private readonly snapshots = new Map<string, ChatRuntimeSnapshot>();
  private readonly lastPersistedAt = new Map<string, number>();
  private readonly seenEvents = new Set<string>();
  private readonly recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly errorTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly hardDeadlineTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly historyPollTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly historyPollBackoff = new Map<string, number>();
  private readonly projectedTranscriptEvents = new Map<string, Set<string>>();
  private readonly dirtySnapshots = new Map<string, ChatRuntimeSnapshot>();
  private readonly persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly persistOperations = new Map<string, Promise<void>>();
  private readonly transcriptSettleRuns = new Map<string, Promise<void>>();
  private readonly transcriptCompensationRuns = new Map<string, Promise<void>>();
  private readonly diagnostics = new Map<string, RunDiagnostics>();
  private initializationState: 'uninitialized' | 'initializing' | 'ready' | 'degraded' = 'uninitialized';
  private initializePromise: Promise<void> | null = null;
  private initializeRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly sessionOperations = new Map<string, Promise<unknown>>();

  constructor(private readonly gatewayManager: GatewayManager) {
    super();
    this.attachGatewayEvents();
  }

  async initialize(): Promise<void> {
    if (this.initializationState === 'ready') return;
    if (this.initializePromise) return this.initializePromise;
    this.initializationState = 'initializing';
    this.initializePromise = this.initializeFromRepository();
    try {
      await this.initializePromise;
      this.initializationState = 'ready';
    } catch (error) {
      this.initializationState = 'degraded';
      this.scheduleInitializationRetry();
      throw error;
    } finally {
      this.initializePromise = null;
    }
  }

  private scheduleInitializationRetry(): void {
    if (this.initializeRetryTimer) return;
    this.initializeRetryTimer = setTimeout(() => {
      this.initializeRetryTimer = null;
      void this.initialize().catch((error) => {
        logger.warn('[chat-runtime] initialize retry failed', error);
      });
    }, RECOVERY_RETRY_MS);
  }

  private async initializeFromRepository(): Promise<void> {
    const active = await getChatRuntimeRepository().listActive();
      const latestBySession = new Map<string, ChatRuntimeSnapshot>();
      for (const stored of active) {
        const previous = latestBySession.get(stored.sessionKey);
        if (previous) {
          await getChatRuntimeRepository().upsert({
            ...previous,
            phase: 'interrupted',
            terminalAt: Date.now(),
            error: 'Superseded by a newer active run during recovery.',
            updatedAt: Date.now(),
          });
        }
        latestBySession.set(stored.sessionKey, stored);
      }
      for (const stored of latestBySession.values()) {
        const recovered: ChatRuntimeSnapshot = {
          ...stored,
          runtimePolicy: normalizeRuntimePolicy(stored.runtimePolicy, stored.startedAt),
          phase: 'reconciling',
          epoch: stored.epoch + 1,
          sequence: 0,
          updatedAt: Date.now(),
        };
        this.snapshots.set(recovered.sessionKey, recovered);
        await this.persist(recovered, true);
        this.scheduleRecovery(recovered.sessionKey, Date.now());
        this.scheduleHardDeadline(recovered.sessionKey, recovered.epoch);
        this.scheduleHistoryPoll(recovered.sessionKey);
      }
    try {
      await getChatRuntimeRepository().prune();
    } catch (error) {
      logger.warn('[chat-runtime] prune failed', error);
    }
  }

  getInitializationState(): typeof this.initializationState {
    return this.initializationState;
  }

  private enqueueSession<T>(sessionKey: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.sessionOperations.get(sessionKey) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.sessionOperations.set(sessionKey, current);
    void current.finally(() => {
      if (this.sessionOperations.get(sessionKey) === current) this.sessionOperations.delete(sessionKey);
    }).catch(() => undefined);
    return current;
  }

  get(sessionKey: string): ChatRuntimeSnapshot | null {
    return this.snapshots.get(sessionKey) ?? null;
  }

  async getHydrated(sessionKey: string): Promise<ChatRuntimeSnapshot | null> {
    if (this.get(sessionKey)) return this.get(sessionKey);
    try {
      return await getChatRuntimeRepository().getLatestForSession(sessionKey);
    } catch (error) {
      logger.debug('[chat-runtime] hydrate repository unavailable', { sessionKey, error: String(error) });
      return null;
    }
  }

  async getByOwner(origin: ChatRuntimePolicy['origin'], ownerId: string): Promise<ChatRuntimeSnapshot | null> {
    const inMemory = [...this.snapshots.values()].find((snapshot) => (
      snapshot.runtimePolicy?.origin === origin && snapshot.runtimePolicy.ownerId === ownerId
    ));
    return inMemory ?? getChatRuntimeRepository().getByOwner(origin, ownerId);
  }

  async adoptPolicy(
    sessionKey: string,
    idempotencyKey: string,
    runtimePolicy: ChatRuntimePolicy,
  ): Promise<ChatRuntimeSnapshot | null> {
    const current = this.snapshots.get(sessionKey)
      ?? await getChatRuntimeRepository().getByIdempotencyKey(sessionKey, idempotencyKey);
    if (!current || current.idempotencyKey !== idempotencyKey) return null;
    const next = { ...current, runtimePolicy: normalizeRuntimePolicy(runtimePolicy, current.startedAt), updatedAt: Date.now() };
    this.snapshots.set(sessionKey, next);
    await this.persist(next, true);
    if (!isTerminalChatRunPhase(next.phase)) this.scheduleHardDeadline(sessionKey, next.epoch);
    return next;
  }

  listActive(): ChatRuntimeSnapshot[] {
    return [...this.snapshots.values()].filter((snapshot) => !isTerminalChatRunPhase(snapshot.phase));
  }

  async begin(input: {
    sessionKey: string;
    idempotencyKey: string;
    engineType: AgentEngineType;
    runtimePolicy?: ChatRuntimePolicy;
    displayText?: string;
  }): Promise<BeginRuntimeResult> {
    return this.enqueueSession(input.sessionKey, () => this.beginUnlocked(input));
  }

  private async beginUnlocked(input: {
    sessionKey: string;
    idempotencyKey: string;
    engineType: AgentEngineType;
    runtimePolicy?: ChatRuntimePolicy;
    displayText?: string;
  }): Promise<BeginRuntimeResult> {
    try {
      await this.initialize();
    } catch (error) {
      const message = `CHAT_RUNTIME_UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`;
      logger.warn('[chat-runtime] send rejected because persistence is unavailable', { error: message });
      return { kind: 'unavailable', error: message };
    }
    let replay: ChatRuntimeSnapshot | null;
    try {
      replay = await getChatRuntimeRepository().getByIdempotencyKey(input.sessionKey, input.idempotencyKey);
    } catch (error) {
      const message = `CHAT_RUNTIME_UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`;
      logger.warn('[chat-runtime] idempotency check unavailable; send rejected', { error: message });
      return { kind: 'unavailable', error: message };
    }
    if (replay) {
      this.snapshots.set(input.sessionKey, replay);
      return Date.now() - replay.startedAt <= IDEMPOTENCY_REPLAY_WINDOW_MS
        ? { kind: 'replay', snapshot: replay }
        : { kind: 'expired_key', snapshot: replay };
    }
    const now = Date.now();
    const prior = this.snapshots.get(input.sessionKey);
    if (prior && !isTerminalChatRunPhase(prior.phase) && prior.idempotencyKey !== input.idempotencyKey) {
      await this.publish({
        ...prior,
        error: 'Superseded by a newer send in the same session.',
      }, 'run.interrupted', { reason: 'superseded' }, true);
    }
    const snapshot: ChatRuntimeSnapshot = {
      protocolVersion: CHAT_RUNTIME_PROTOCOL_VERSION,
      sessionKey: input.sessionKey,
      runId: null,
      idempotencyKey: input.idempotencyKey,
      runtimePolicy: normalizeRuntimePolicy(input.runtimePolicy, now),
      engineType: input.engineType,
      phase: 'dispatching',
      epoch: (prior?.epoch ?? 0) + 1,
      sequence: 0,
      startedAt: now,
      lastEventAt: now,
      terminalAt: null,
      error: null,
      acceptanceResult: null,
      updatedAt: now,
    };
    this.projectedTranscriptEvents.delete(input.sessionKey);
    this.historyPollBackoff.delete(input.sessionKey);
    this.diagnostics.set(input.sessionKey, {
      polls: 0,
      transcriptRevisions: 0,
      canonicalEvents: 0,
      databaseWrites: 0,
    });
    this.snapshots.set(input.sessionKey, snapshot);
    // 定时任务不注入乐观 user 消息（X2）：任务会话的 user 气泡完全由 server echo 渲染，
    // 避免乐观消息携带 gateway 原文（[文件:] 占位符 / 字面 \n）直接上屏。
    // chat 链路行为不变：渲染侧已有同 id 乐观消息，dispatch 携带的本来就会被
    // currentOptimisticBelongsToRun 忽略。
    const displayText = snapshot.runtimePolicy.origin === 'scheduled_task'
      ? ''
      : input.displayText?.trim();
    const dispatchPayload: ChatDispatchPayload = {
      idempotencyKey: input.idempotencyKey,
      ...(displayText ? {
        optimisticUserMessage: {
          id: input.idempotencyKey,
          role: 'user' as const,
          content: displayText,
          timestamp: now / 1_000,
        },
      } : {}),
    };
    await this.publish(snapshot, 'run.dispatching', dispatchPayload, true);
    this.scheduleHardDeadline(input.sessionKey, snapshot.epoch);
    this.scheduleHistoryPoll(input.sessionKey);
    return { kind: 'created', snapshot: this.snapshots.get(input.sessionKey) as ChatRuntimeSnapshot };
  }

  async accepted(input: {
    sessionKey: string;
    idempotencyKey: string;
    runId?: string;
    engineType: AgentEngineType;
    result?: unknown;
  }): Promise<void> {
    return this.enqueueSession(input.sessionKey, () => this.acceptedUnlocked(input));
  }

  private async acceptedUnlocked(input: {
    sessionKey: string;
    idempotencyKey: string;
    runId?: string;
    engineType: AgentEngineType;
    result?: unknown;
  }): Promise<void> {
    let current = this.snapshots.get(input.sessionKey);
    if (!current) {
      const beginResult = await this.beginUnlocked(input);
      if (beginResult.kind === 'unavailable') return;
      current = beginResult.snapshot;
    }
    if (current.idempotencyKey !== input.idempotencyKey) return;
    if (isTerminalChatRunPhase(current.phase)) {
      const metadata = patchTerminalRuntimeMetadata(current, {
        runId: input.runId?.trim() || current.runId,
        acceptanceResult: input.result ?? current.acceptanceResult,
      });
      this.snapshots.set(input.sessionKey, metadata);
      await this.persist(metadata, true);
      return;
    }
    await this.publish({
      ...current,
      runId: input.runId?.trim() || current.runId,
      engineType: input.engineType,
      acceptanceResult: input.result ?? null,
      error: null,
    }, 'run.accepted', input.result, true);
  }

  async rejected(input: {
    sessionKey: string;
    idempotencyKey: string;
    error: string;
    uncertain?: boolean;
  }): Promise<void> {
    return this.enqueueSession(input.sessionKey, () => this.rejectedUnlocked(input));
  }

  private async rejectedUnlocked(input: {
    sessionKey: string;
    idempotencyKey: string;
    error: string;
    uncertain?: boolean;
  }): Promise<void> {
    const current = this.snapshots.get(input.sessionKey);
    if (!current || current.idempotencyKey !== input.idempotencyKey) return;
    if (input.uncertain) {
      const transition = transitionChatRuntimePhase({
        snapshot: current,
        phase: 'uncertain',
        occurredAt: Date.now(),
        patch: { error: null },
      });
      if (!transition.accepted) return;
      const uncertain = transition.snapshot;
      this.snapshots.set(input.sessionKey, uncertain);
      await this.persist(uncertain, true);
      this.scheduleRecovery(input.sessionKey, Date.now());
      return;
    }
    await this.publish({ ...current, error: input.error }, 'run.failed', { error: input.error }, true);
  }

  async aborting(sessionKey: string): Promise<void> {
    return this.enqueueSession(sessionKey, () => this.abortingUnlocked(sessionKey));
  }

  private async abortingUnlocked(sessionKey: string): Promise<void> {
    const current = this.snapshots.get(sessionKey);
    if (!current || isTerminalChatRunPhase(current.phase)) return;
    const transition = transitionChatRuntimePhase({ snapshot: current, phase: 'aborting', occurredAt: Date.now() });
    if (!transition.accepted) return;
    const next = transition.snapshot;
    this.snapshots.set(sessionKey, next);
    await this.persist(next, true);
  }

  async aborted(sessionKey: string, runId?: string | null): Promise<void> {
    return this.enqueueSession(sessionKey, () => this.abortedUnlocked(sessionKey, runId));
  }

  private async abortedUnlocked(sessionKey: string, runId?: string | null): Promise<void> {
    const current = this.snapshots.get(sessionKey);
    if (!current || (runId && current.runId && runId !== current.runId)) return;
    await this.publish(current, 'run.aborted', undefined, true);
  }

  async abortFailed(sessionKey: string, error: string): Promise<void> {
    return this.enqueueSession(sessionKey, () => this.abortFailedUnlocked(sessionKey, error));
  }

  private async abortFailedUnlocked(sessionKey: string, error: string): Promise<void> {
    const current = this.snapshots.get(sessionKey);
    if (!current || current.phase !== 'aborting') return;
    const transition = transitionChatRuntimePhase({
      snapshot: current,
      phase: 'running',
      occurredAt: Date.now(),
      patch: { error },
    });
    if (!transition.accepted) return;
    const next = transition.snapshot;
    this.snapshots.set(sessionKey, next);
    await this.persist(next, true);
  }

  async handleEngineEvent(event: NormalizedEngineEvent, engineType?: AgentEngineType): Promise<void> {
    const sessionKey = event.sessionKey?.trim();
    if (!sessionKey) return;
    return this.enqueueSession(sessionKey, () => this.handleEngineEventUnlocked(event, engineType));
  }

  private async handleEngineEventUnlocked(event: NormalizedEngineEvent, engineType?: AgentEngineType): Promise<void> {
    const sessionKey = event.sessionKey?.trim();
    if (!sessionKey) return;
    if (isWorkflowOpenClawSessionKey(sessionKey)) return;
    const eventType = eventTypeForEngineEvent(event);
    const sourceIdentity = event.seq != null
      ? String(event.seq)
      : String(JSON.stringify('message' in event ? event.message : event) ?? '').slice(0, 2_000);
    const dedupeKey = `${sessionKey}\u0000${event.runId ?? ''}\u0000${sourceIdentity}\u0000${eventType}`;
    if (this.seenEvents.has(dedupeKey)) return;
    this.seenEvents.add(dedupeKey);
    if (this.seenEvents.size > 2_000) this.seenEvents.delete(this.seenEvents.values().next().value as string);

    let current = this.snapshots.get(sessionKey) ?? await this.getHydrated(sessionKey);
    if (current && isTerminalChatRunPhase(current.phase) && eventType !== 'run.started') return;
    if (current?.runId && event.runId && current.runId !== event.runId) return;
    if (!current) {
      const now = Date.now();
      current = {
        protocolVersion: CHAT_RUNTIME_PROTOCOL_VERSION,
        sessionKey,
        runId: event.runId ?? null,
        idempotencyKey: null,
        runtimePolicy: normalizeRuntimePolicy(undefined, now),
        engineType: engineType ?? inferEngineType(sessionKey),
        phase: 'running',
        epoch: 1,
        sequence: 0,
        startedAt: now,
        lastEventAt: now,
        terminalAt: null,
        error: null,
        acceptanceResult: null,
        updatedAt: now,
      };
      this.scheduleHardDeadline(sessionKey, current.epoch);
      this.scheduleHistoryPoll(sessionKey);
    }
    if (event.type === 'turn.failed') {
      this.scheduleErrorFinalization(sessionKey, event.runId ?? current.runId, event.errorMessage);
      return;
    }
    this.clearErrorFinalization(sessionKey);
    const payload = 'message' in event ? event.message : getRecord(event)?.runtimeResult;
    const liveMessage = getRecord(payload);
    if (liveMessage && (event.type === 'message.delta' || event.type === 'message.final' || event.type === 'tool.result')) {
      // Reliable live progress lets history projection back off until a persisted
      // reasoning/tool revision actually changes.
      this.historyPollBackoff.set(sessionKey, 1);
      let projected = this.projectedTranscriptEvents.get(sessionKey);
      if (!projected) {
        projected = new Set<string>();
        this.projectedTranscriptEvents.set(sessionKey, projected);
      }
      projected.add(transcriptMessageFingerprint(liveMessage, 0));
    }
    const adapter = await getAdapterForSession(sessionKey, engineType ?? current.engineType);
    const finalClassification = event.type === 'message.final'
      ? adapter?.classifyFinalMessage?.({ message: event.message, phase: event.phase })
        ?? (event.message == null ? 'awaiting_transcript' : event.phase === 'completed' ? 'completed' : 'progress')
      : null;
    const engineCompleted = event.type === 'turn.completed' || finalClassification === 'completed';
    const canonicalType = engineCompleted || finalClassification === 'awaiting_transcript'
      ? 'run.awaiting_transcript'
      : eventType;
    await this.publish({
      ...current,
      runId: event.runId ?? current.runId,
      engineType: engineType ?? current.engineType,
      error: current.error,
    }, canonicalType, payload, canonicalType.startsWith('run.'));

    const latest = this.snapshots.get(sessionKey);
    if (engineCompleted && latest) this.startTranscriptSettle(latest, event.type);
  }

  private async publish(
    base: ChatRuntimeSnapshot,
    type: CanonicalChatEventType,
    payload?: unknown,
    forcePersist = false,
  ): Promise<void> {
    const now = Date.now();
    const transition = transitionChatRuntime({ snapshot: base, type, occurredAt: now });
    if (!transition.accepted) {
      logger.debug('[chat-runtime] transition rejected', {
        sessionKey: base.sessionKey,
        phase: base.phase,
        eventType: type,
        reason: transition.reason,
      });
      return;
    }
    const snapshot = transition.snapshot;
    const phase = snapshot.phase;
    this.snapshots.set(snapshot.sessionKey, snapshot);
    const event: CanonicalChatEvent = {
      protocolVersion: CHAT_RUNTIME_PROTOCOL_VERSION,
      eventId: randomUUID(),
      sessionKey: snapshot.sessionKey,
      runId: snapshot.runId,
      idempotencyKey: snapshot.idempotencyKey ?? undefined,
      runtimePolicy: snapshot.runtimePolicy,
      engineType: snapshot.engineType,
      epoch: snapshot.epoch,
      sequence: snapshot.sequence,
      occurredAt: now,
      type,
      payload,
    };
    const diagnostics = this.diagnostics.get(snapshot.sessionKey);
    if (diagnostics) diagnostics.canonicalEvents += 1;
    this.emit('event', event);
    await this.persist(snapshot, forcePersist || isTerminalChatRunPhase(phase));
    if (isTerminalChatRunPhase(phase)) this.clearRecovery(snapshot.sessionKey);
    if (isTerminalChatRunPhase(phase)) {
      this.clearErrorFinalization(snapshot.sessionKey);
      this.clearHardDeadline(snapshot.sessionKey);
      this.clearHistoryPoll(snapshot.sessionKey);
    } else if (phase === 'awaiting_transcript') {
      this.scheduleRecovery(snapshot.sessionKey, Date.now());
    }
    const log = type === 'message.delta' || type === 'tool.updated' ? logger.debug : logger.info;
    log('[chat-runtime]', {
      sessionKey: snapshot.sessionKey,
      runId: snapshot.runId,
      idempotencyKey: snapshot.idempotencyKey,
      eventType: type,
      phase,
      epoch: snapshot.epoch,
      sequence: snapshot.sequence,
    });
    if (isTerminalChatRunPhase(phase) && type !== 'transcript.updated') {
      logger.info('[chat-runtime] run diagnostics', {
        sessionKey: snapshot.sessionKey,
        runId: snapshot.runId,
        ...(this.diagnostics.get(snapshot.sessionKey) ?? {
          polls: 0,
          transcriptRevisions: 0,
          canonicalEvents: 0,
          databaseWrites: 0,
        }),
      });
    }
  }

  private async persist(snapshot: ChatRuntimeSnapshot, force: boolean): Promise<void> {
    const now = Date.now();
    const last = this.lastPersistedAt.get(snapshot.sessionKey) ?? 0;
    const dirty = this.dirtySnapshots.get(snapshot.sessionKey);
    if (!dirty || snapshot.epoch > dirty.epoch || (
      snapshot.epoch === dirty.epoch && snapshot.sequence >= dirty.sequence
    )) this.dirtySnapshots.set(snapshot.sessionKey, snapshot);

    if (force || now - last >= DELTA_PERSIST_THROTTLE_MS) {
      const timer = this.persistTimers.get(snapshot.sessionKey);
      if (timer) clearTimeout(timer);
      this.persistTimers.delete(snapshot.sessionKey);
      await this.enqueuePersist(snapshot.sessionKey);
      return;
    }
    if (this.persistTimers.has(snapshot.sessionKey)) return;
    this.persistTimers.set(snapshot.sessionKey, setTimeout(() => {
      this.persistTimers.delete(snapshot.sessionKey);
      void this.enqueuePersist(snapshot.sessionKey);
    }, Math.max(1, DELTA_PERSIST_THROTTLE_MS - (now - last))));
  }

  private enqueuePersist(sessionKey: string): Promise<void> {
    const previous = this.persistOperations.get(sessionKey) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      const snapshot = this.dirtySnapshots.get(sessionKey);
      if (!snapshot) return;
      try {
        const repository = getChatRuntimeRepository();
        const result = typeof repository.upsertIfNewer === 'function'
          ? await repository.upsertIfNewer(snapshot)
          : (await repository.upsert(snapshot), 'updated' as const);
        const current = this.dirtySnapshots.get(sessionKey);
        if (current === snapshot) this.dirtySnapshots.delete(sessionKey);
        this.lastPersistedAt.set(sessionKey, Date.now());
        const diagnostics = this.diagnostics.get(sessionKey);
        if (diagnostics && result !== 'stale') diagnostics.databaseWrites += 1;
        if (result === 'stale') {
          logger.debug('[chat-runtime] stale persistence rejected', {
            sessionKey,
            epoch: snapshot.epoch,
            sequence: snapshot.sequence,
          });
        }
      } catch (error) {
        logger.warn('[chat-runtime] persist failed', { sessionKey, error });
        if (!this.persistTimers.has(sessionKey)) {
          this.persistTimers.set(sessionKey, setTimeout(() => {
            this.persistTimers.delete(sessionKey);
            void this.enqueuePersist(sessionKey);
          }, DELTA_PERSIST_THROTTLE_MS));
        }
      }
    });
    this.persistOperations.set(sessionKey, operation);
    void operation.finally(() => {
      if (this.persistOperations.get(sessionKey) === operation) this.persistOperations.delete(sessionKey);
    }).catch(() => undefined);
    return operation;
  }

  private attachGatewayEvents(): void {
    if (typeof this.gatewayManager.on !== 'function') return;
    this.gatewayManager.on('chat:message', (value: unknown) => {
      const payload = getRecord(value);
      const event = getRecord(payload?.engineEvent) as NormalizedEngineEvent | null;
      if (event?.type) void this.handleEngineEvent(event);
    });
    this.gatewayManager.on('notification', (value: unknown) => {
      const notification = getRecord(value);
      const params = getRecord(notification?.params);
      if (notification?.method !== 'agent' || !params) return;
      const phase = String(params.phase ?? '');
      const common = {
        runId: typeof params.runId === 'string' ? params.runId : undefined,
        sessionKey: typeof params.sessionKey === 'string' ? params.sessionKey : undefined,
      };
      if (phase === 'started' || phase === 'start') {
        void this.handleEngineEvent({ ...common, type: 'turn.started' });
      } else if (['completed', 'done', 'finished', 'end'].includes(phase)) {
        void this.handleEngineEvent({ ...common, type: 'turn.completed', phase });
      }
    });
    this.gatewayManager.on('status', (status) => {
      if (status.state === 'running') void this.reconcileActive();
    });
  }

  private scheduleRecovery(sessionKey: string, startedAt: number): void {
    this.clearRecovery(sessionKey);
    const run = async () => {
      const current = this.snapshots.get(sessionKey);
      if (!current || isTerminalChatRunPhase(current.phase)) return;
      if (Date.now() - startedAt >= RECOVERY_DEADLINE_MS) {
        await this.publish({ ...current, error: 'Unable to confirm whether the run is still active.' }, 'run.interrupted', {
          reason: 'recovery-timeout',
        }, true);
        return;
      }
      await this.reconcileSession(sessionKey);
      const latest = this.snapshots.get(sessionKey);
      if (
        latest
        && !isTerminalChatRunPhase(latest.phase)
        && ['reconciling', 'uncertain', 'awaiting_transcript'].includes(latest.phase)
      ) {
        this.recoveryTimers.set(sessionKey, setTimeout(run, RECOVERY_RETRY_MS));
      }
    };
    this.recoveryTimers.set(sessionKey, setTimeout(run, 0));
  }

  private async reconcileActive(): Promise<void> {
    for (const snapshot of this.listActive()) await this.reconcileSession(snapshot.sessionKey);
  }

  private async reconcileSession(sessionKey: string, projectTranscript = false): Promise<void> {
    return this.enqueueSession(sessionKey, () => this.reconcileSessionUnlocked(sessionKey, projectTranscript));
  }

  private async reconcileSessionUnlocked(sessionKey: string, projectTranscript = false): Promise<void> {
    const current = this.snapshots.get(sessionKey);
    if (!current || isTerminalChatRunPhase(current.phase)) return;
    try {
      const adapter = await getAdapterForSession(sessionKey, current.engineType);
      const history = await adapter.getHistory({ gatewayManager: this.gatewayManager }, { sessionKey, limit: 50 });
      const historyResult = history.result;
      if (!history.success || !historyResult) return;
      if (projectTranscript) {
        await this.projectCurrentTranscript(current, historyResult.messages);
      }
      const latest = this.snapshots.get(sessionKey) ?? current;
      if (isTerminalChatRunPhase(latest.phase)) return;
      const inspection = typeof adapter?.inspectRun === 'function'
        ? await adapter.inspectRun(
          { gatewayManager: this.gatewayManager },
          { sessionKey, runId: latest.runId, startedAt: latest.startedAt, limit: 50 },
        )
        : inspectTranscript({
          messages: historyResult.messages,
          startedAt: latest.startedAt,
          isRunning: historyResult.isRunning,
          runId: latest.runId,
        });
      if (inspection?.status === 'active' || (!inspection && historyResult.isRunning === true)) {
        const transition = transitionChatRuntimePhase({
          snapshot: latest,
          phase: 'running',
          occurredAt: Date.now(),
          patch: { error: null },
        });
        if (!transition.accepted) return;
        const next = transition.snapshot;
        this.snapshots.set(sessionKey, next);
        await this.persist(next, true);
      } else if (inspection?.status === 'completed') {
        if (latest.phase !== 'awaiting_transcript') {
          await this.publish(latest, 'run.awaiting_transcript', {
            reconcileReason: 'adapter-inspection',
          }, true);
        }
        const awaiting = this.snapshots.get(sessionKey);
        if (awaiting && !isTerminalChatRunPhase(awaiting.phase)) {
          this.startTranscriptSettle(awaiting, 'reconcile');
        }
      } else if (inspection?.status === 'not_started') {
        await this.publish({ ...latest, error: 'The engine did not start this run.' }, 'run.interrupted', {
          reason: 'engine-not-started',
        }, true);
      } else if (latest.phase !== 'awaiting_transcript') {
        const transition = transitionChatRuntimePhase({
          snapshot: latest,
          phase: 'reconciling',
          occurredAt: Date.now(),
        });
        if (!transition.accepted) return;
        const next = transition.snapshot;
        this.snapshots.set(sessionKey, next);
        await this.persist(next, true);
      }
    } catch (error) {
      logger.debug('[chat-runtime] reconcile deferred', { sessionKey, error: String(error) });
    }
  }

  private async projectCurrentTranscript(snapshot: ChatRuntimeSnapshot, messages: unknown[]): Promise<number> {
    const turnMessages = currentRunTranscriptMessages(snapshot, messages);
    if (turnMessages.length === 0) return 0;
    let seen = this.projectedTranscriptEvents.get(snapshot.sessionKey);
    if (!seen) {
      seen = new Set<string>();
      this.projectedTranscriptEvents.set(snapshot.sessionKey, seen);
    }
    let projectedCount = 0;
    for (let index = 0; index < turnMessages.length; index += 1) {
      const message = getRecord(turnMessages[index]);
      if (!message) continue;
      const role = String(message.role ?? '').toLowerCase();
      if (role !== 'assistant' && role !== 'tool' && role !== 'toolresult' && role !== 'tool_result') continue;
      const fingerprint = transcriptMessageFingerprint(message, index);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      if (seen.size > 500) seen.delete(seen.values().next().value as string);
      const latest = this.snapshots.get(snapshot.sessionKey);
      if (!latest || isTerminalChatRunPhase(latest.phase)) return projectedCount;
      await this.publish(
        latest,
        role === 'assistant' ? 'message.delta' : 'tool.updated',
        message,
      );
      projectedCount += 1;
    }
    if (projectedCount > 0) {
      const diagnostics = this.diagnostics.get(snapshot.sessionKey);
      if (diagnostics) diagnostics.transcriptRevisions += projectedCount;
    }
    return projectedCount;
  }

  private clearRecovery(sessionKey: string): void {
    const timer = this.recoveryTimers.get(sessionKey);
    if (timer) clearTimeout(timer);
    this.recoveryTimers.delete(sessionKey);
  }

  private scheduleErrorFinalization(sessionKey: string, runId: string | null, error: string): void {
    this.clearErrorFinalization(sessionKey);
    const timer = setTimeout(() => {
      this.errorTimers.delete(sessionKey);
      const current = this.snapshots.get(sessionKey);
      if (!current || isTerminalChatRunPhase(current.phase)) return;
      if (runId && current.runId && runId !== current.runId) return;
      void this.enqueueSession(sessionKey, async () => {
        const latest = this.snapshots.get(sessionKey);
        if (!latest || isTerminalChatRunPhase(latest.phase)) return;
        if (runId && latest.runId && runId !== latest.runId) return;
        await this.publish({ ...latest, error }, 'run.failed', { error }, true);
      });
    }, ERROR_RECOVERY_GRACE_MS);
    this.errorTimers.set(sessionKey, timer);
  }

  private clearErrorFinalization(sessionKey: string): void {
    const timer = this.errorTimers.get(sessionKey);
    if (timer) clearTimeout(timer);
    this.errorTimers.delete(sessionKey);
  }

  private scheduleHardDeadline(sessionKey: string, epoch: number): void {
    this.clearHardDeadline(sessionKey);
    const snapshot = this.snapshots.get(sessionKey);
    const deadlineAt = snapshot?.runtimePolicy.deadlineAt;
    if (deadlineAt == null) return;
    const delay = Math.max(0, deadlineAt - Date.now());
    const timer = setTimeout(() => {
      this.hardDeadlineTimers.delete(sessionKey);
      const current = this.snapshots.get(sessionKey);
      if (!current || current.epoch !== epoch || isTerminalChatRunPhase(current.phase)) return;
      void this.enqueueSession(sessionKey, () => this.interruptByPolicy(current, 'hard-deadline'));
    }, delay);
    this.hardDeadlineTimers.set(sessionKey, timer);
  }

  private async interruptByPolicy(snapshot: ChatRuntimeSnapshot, reason: string): Promise<void> {
    let abortError: string | undefined;
    try {
      const adapter = await getAdapterForSession(snapshot.sessionKey, snapshot.engineType);
      const result = await adapter.abortRun(
        { gatewayManager: this.gatewayManager },
        { sessionKey: snapshot.sessionKey, runId: snapshot.runId ?? undefined },
      );
      if (!result.success) abortError = result.error ?? 'engine abort returned non-success';
    } catch (error) {
      abortError = error instanceof Error ? error.message : String(error);
    }
    const current = this.snapshots.get(snapshot.sessionKey);
    if (!current || isTerminalChatRunPhase(current.phase) || current.epoch !== snapshot.epoch) return;
    await this.publish({
      ...current,
      error: 'The run exceeded its configured deadline.',
    }, 'run.interrupted', { reason, ...(abortError ? { abortError } : {}) }, true);
  }

  private clearHardDeadline(sessionKey: string): void {
    const timer = this.hardDeadlineTimers.get(sessionKey);
    if (timer) clearTimeout(timer);
    this.hardDeadlineTimers.delete(sessionKey);
  }

  private scheduleHistoryPoll(sessionKey: string): void {
    if (this.historyPollTimers.has(sessionKey)) return;
    const poll = async () => {
      this.historyPollTimers.delete(sessionKey);
      const current = this.snapshots.get(sessionKey);
      if (!current || isTerminalChatRunPhase(current.phase)) return;
      const adapter = await getAdapterForSession(sessionKey, current.engineType);
      if (!adapter) return;
      if (adapter.chatCapabilities && !adapter.chatCapabilities.requiresHistoryProjection) return;
      // OpenClaw's live assistant buffer does not always include the persisted
      // reasoning/tool records. Project current-turn history even while deltas
      // are flowing so the canonical overlay stays chronologically complete.
      const diagnostics = this.diagnostics.get(sessionKey);
      if (diagnostics) diagnostics.polls += 1;
      const before = this.projectedTranscriptEvents.get(sessionKey)?.size ?? 0;
      await this.reconcileSession(sessionKey, true);
      const after = this.projectedTranscriptEvents.get(sessionKey)?.size ?? 0;
      const changed = after > before;
      const currentBackoff = this.historyPollBackoff.get(sessionKey) ?? 0;
      const nextBackoff = changed
        ? 0
        : Math.min(currentBackoff + 1, HISTORY_POLL_BACKOFF_MS.length - 1);
      this.historyPollBackoff.set(sessionKey, nextBackoff);
      const latest = this.snapshots.get(sessionKey);
      if (latest && !isTerminalChatRunPhase(latest.phase)) {
        this.historyPollTimers.set(sessionKey, setTimeout(poll, HISTORY_POLL_BACKOFF_MS[nextBackoff]));
      }
    };
    this.historyPollTimers.set(sessionKey, setTimeout(poll, HISTORY_POLL_START_DELAY_MS));
  }

  private startTranscriptSettle(snapshot: ChatRuntimeSnapshot, reason: string): void {
    if (this.transcriptSettleRuns.has(snapshot.sessionKey)) return;
    const operation = this.settleTranscript(snapshot.sessionKey, snapshot.epoch, reason);
    this.transcriptSettleRuns.set(snapshot.sessionKey, operation);
    void operation.finally(() => {
      if (this.transcriptSettleRuns.get(snapshot.sessionKey) === operation) {
        this.transcriptSettleRuns.delete(snapshot.sessionKey);
      }
    }).catch(() => undefined);
  }

  private async settleTranscript(sessionKey: string, epoch: number, reason: string): Promise<void> {
    const delays = [0, 300, 800, 1_600];
    let previousRevision: string | undefined;
    let confirmed = false;
    for (const delay of delays) {
      if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
      const current = this.snapshots.get(sessionKey);
      if (!current || current.epoch !== epoch || isTerminalChatRunPhase(current.phase)) return;
      try {
        const adapter = await getAdapterForSession(sessionKey, current.engineType);
        if (!adapter || typeof adapter.inspectRun !== 'function') {
          confirmed = true;
          break;
        }
        const inspection = await adapter.inspectRun(
          { gatewayManager: this.gatewayManager },
          { sessionKey, runId: current.runId, startedAt: current.startedAt, limit: 50 },
        );
        if (inspection.currentTurnMessages?.length) {
          // Transcript settling runs independently from live Gateway delivery.
          // Commit projected messages through the same per-session queue as
          // handleEngineEvent; otherwise both paths can derive the same next
          // sequence from a stale snapshot and publish conflicting events.
          await this.enqueueSession(sessionKey, async () => {
            const latest = this.snapshots.get(sessionKey);
            if (!latest || latest.epoch !== epoch || isTerminalChatRunPhase(latest.phase)) return;
            await this.projectCurrentTranscript(latest, inspection.currentTurnMessages ?? []);
          });
        }
        if (inspection.status === 'completed' && inspection.transcriptRevision) {
          if (previousRevision === inspection.transcriptRevision) {
            confirmed = true;
            break;
          }
          previousRevision = inspection.transcriptRevision;
        }
      } catch (error) {
        logger.debug('[chat-runtime] transcript settle deferred', { sessionKey, error: String(error) });
      }
    }
    await this.enqueueSession(sessionKey, async () => {
      const current = this.snapshots.get(sessionKey);
      if (!current || current.epoch !== epoch || isTerminalChatRunPhase(current.phase)) return;
      await this.publish(current, 'run.completed', {
        reconcileReason: reason,
        transcriptPending: !confirmed,
      }, true);
      const completed = this.snapshots.get(sessionKey);
      if (!confirmed && completed?.phase === 'completed') {
        this.startTranscriptCompensation(completed, reason);
      }
    });
  }

  private startTranscriptCompensation(snapshot: ChatRuntimeSnapshot, reason: string): void {
    if (this.transcriptCompensationRuns.has(snapshot.sessionKey)) return;
    const operation = this.compensateTranscript(snapshot.sessionKey, snapshot.epoch, reason);
    this.transcriptCompensationRuns.set(snapshot.sessionKey, operation);
    void operation.finally(() => {
      if (this.transcriptCompensationRuns.get(snapshot.sessionKey) === operation) {
        this.transcriptCompensationRuns.delete(snapshot.sessionKey);
      }
    }).catch(() => undefined);
  }

  private async compensateTranscript(sessionKey: string, epoch: number, reason: string): Promise<void> {
    let previousRevision: string | undefined;
    let latestRevision: string | undefined;
    let confirmed = false;
    for (const delay of TRANSCRIPT_COMPENSATION_DELAYS_MS) {
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      const current = this.snapshots.get(sessionKey);
      if (!current || current.epoch !== epoch || current.phase !== 'completed') return;
      try {
        const adapter = await getAdapterForSession(sessionKey, current.engineType);
        if (!adapter || typeof adapter.inspectRun !== 'function') return;
        const inspection = await adapter.inspectRun(
          { gatewayManager: this.gatewayManager },
          { sessionKey, runId: current.runId, startedAt: current.startedAt, limit: 50 },
        );
        if (inspection.status !== 'completed' || !inspection.transcriptRevision) continue;
        latestRevision = inspection.transcriptRevision;
        if (previousRevision === latestRevision) {
          confirmed = true;
          break;
        }
        previousRevision = latestRevision;
      } catch (error) {
        logger.debug('[chat-runtime] transcript compensation deferred', { sessionKey, error: String(error) });
      }
    }
    if (!latestRevision) return;
    await this.enqueueSession(sessionKey, async () => {
      const current = this.snapshots.get(sessionKey);
      if (!current || current.epoch !== epoch || current.phase !== 'completed') return;
      await this.publish(current, 'transcript.updated', {
        transcriptRevision: latestRevision,
        reconcileReason: `${reason}-compensation`,
        confirmed,
      }, true);
    });
  }

  private clearHistoryPoll(sessionKey: string): void {
    const timer = this.historyPollTimers.get(sessionKey);
    if (timer) clearTimeout(timer);
    this.historyPollTimers.delete(sessionKey);
    this.historyPollBackoff.delete(sessionKey);
  }
}

const supervisors = new WeakMap<GatewayManager, ChatRuntimeSupervisor>();

export function getChatRuntimeSupervisor(gatewayManager: GatewayManager): ChatRuntimeSupervisor {
  let supervisor = supervisors.get(gatewayManager);
  if (!supervisor) {
    supervisor = new ChatRuntimeSupervisor(gatewayManager);
    supervisors.set(gatewayManager, supervisor);
    void supervisor.initialize().catch((error) => {
      logger.warn('[chat-runtime] initialize failed', error);
    });
  }
  return supervisor;
}
