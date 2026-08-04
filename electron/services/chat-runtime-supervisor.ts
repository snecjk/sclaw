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
  type ChatRunPhase,
  type ChatRuntimeSnapshot,
  type ChatRuntimePolicy,
  isTerminalChatRunPhase,
} from '../../shared/chat-runtime-protocol';
import { logger } from '../utils/logger';
import { isWorkflowOpenClawSessionKey } from '../../shared/workflow-openclaw-session';

const RECOVERY_DEADLINE_MS = 135_000;
const RECOVERY_RETRY_MS = 5_000;
const DELTA_PERSIST_THROTTLE_MS = 1_000;
const ERROR_RECOVERY_GRACE_MS = 15_000;
const RUN_HARD_DEADLINE_MS = 20 * 60_000;
const HISTORY_POLL_START_DELAY_MS = 1_000;
const HISTORY_POLL_INTERVAL_MS = 2_000;

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

function hasAssistantOutput(message: Record<string, unknown> | null): boolean {
  if (!message) return false;
  if (typeof message.content === 'string' && message.content.trim()) return true;
  if (typeof message.text === 'string' && message.text.trim()) return true;
  return Array.isArray(message.content) && message.content.some((block) => {
    const item = getRecord(block);
    return typeof item?.text === 'string' && item.text.trim().length > 0;
  });
}

function historyHasCompletedTurn(messages: unknown[]): boolean {
  let lastUserIndex = -1;
  for (let index = 0; index < messages.length; index += 1) {
    const message = getRecord(messages[index]);
    if (String(message?.role ?? '').toLowerCase() === 'user') lastUserIndex = index;
  }
  if (lastUserIndex < 0) return false;
  return messages.slice(lastUserIndex + 1).some((value) => {
    const message = getRecord(value);
    return String(message?.role ?? '').toLowerCase() === 'assistant'
      && hasAssistantOutput(message);
  });
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
  let currentUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = getRecord(messages[index]);
    if (String(message?.role ?? '').toLowerCase() !== 'user') continue;
    const occurredAt = messageOccurredAt(message);
    // OpenClaw history normally includes a timestamp. A small allowance keeps
    // second-rounded timestamps from excluding the user message that began the run.
    if (occurredAt > 0 && occurredAt < snapshot.startedAt - 2_000) return [];
    currentUserIndex = index;
    break;
  }
  return currentUserIndex < 0 ? [] : messages.slice(currentUserIndex + 1);
}

function transcriptMessageFingerprint(message: Record<string, unknown>, index: number): string {
  const identity = message.id ?? message.messageId ?? message.toolCallId ?? message.tool_call_id ?? index;
  try {
    return `${String(identity)}\u0000${JSON.stringify(message) ?? ''}`;
  } catch {
    return `${String(identity)}\u0000${String(message.content ?? message.text ?? '')}`;
  }
}

function hasTrailingPendingToolUse(message: Record<string, unknown> | null): boolean {
  if (!message) return false;
  const stopReason = String(message.stopReason ?? message.stop_reason ?? '').toLowerCase();
  if (stopReason === 'tooluse' || stopReason === 'tool_use') return true;
  if (['end_turn', 'endturn', 'stop', 'completed'].includes(stopReason)) return false;
  if (Array.isArray(message.content)) {
    for (let index = message.content.length - 1; index >= 0; index -= 1) {
      const block = getRecord(message.content[index]);
      const type = String(block?.type ?? '');
      if (!type) continue;
      if (type === 'tool_use' || type === 'toolCall') return true;
      if (type === 'text' && typeof block?.text === 'string' && block.text.trim()) return false;
      if (['thinking', 'tool_result', 'toolResult', 'image'].includes(type)) continue;
    }
  }
  const toolCalls = message.tool_calls ?? message.toolCalls;
  return Array.isArray(toolCalls) && toolCalls.length > 0;
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

function phaseForEvent(type: CanonicalChatEventType, current: ChatRunPhase): ChatRunPhase {
  switch (type) {
    case 'run.dispatching': return 'dispatching';
    case 'run.accepted':
    case 'run.started':
    case 'message.delta':
    case 'tool.updated': return 'running';
    case 'message.final': return current;
    case 'run.awaiting_transcript': return 'awaiting_transcript';
    case 'run.completed': return 'completed';
    case 'run.failed': return 'failed';
    case 'run.aborted': return 'aborted';
    case 'run.interrupted': return 'interrupted';
    default: return current;
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
  private readonly projectedTranscriptEvents = new Map<string, Set<string>>();
  private initialized = false;
  private initializePromise: Promise<void> | null = null;

  constructor(private readonly gatewayManager: GatewayManager) {
    super();
    this.attachGatewayEvents();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializePromise) return this.initializePromise;
    this.initializePromise = this.initializeFromRepository();
    try {
      await this.initializePromise;
      this.initialized = true;
    } finally {
      this.initializePromise = null;
    }
  }

  private async initializeFromRepository(): Promise<void> {
    try {
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
      await getChatRuntimeRepository().prune();
    } catch (error) {
      logger.warn('[chat-runtime] initialize failed', error);
    }
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
  }): Promise<ChatRuntimeSnapshot> {
    await this.initialize();
    let replay: ChatRuntimeSnapshot | null = null;
    try {
      replay = await getChatRuntimeRepository().getByIdempotencyKey(input.sessionKey, input.idempotencyKey);
    } catch (error) {
      logger.debug('[chat-runtime] idempotency repository unavailable', { error: String(error) });
    }
    if (replay) {
      this.snapshots.set(input.sessionKey, replay);
      return replay;
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
    this.snapshots.set(input.sessionKey, snapshot);
    await this.publish(snapshot, 'run.dispatching', { idempotencyKey: input.idempotencyKey }, true);
    this.scheduleHardDeadline(input.sessionKey, snapshot.epoch);
    this.scheduleHistoryPoll(input.sessionKey);
    return this.snapshots.get(input.sessionKey) as ChatRuntimeSnapshot;
  }

  async accepted(input: {
    sessionKey: string;
    idempotencyKey: string;
    runId?: string;
    engineType: AgentEngineType;
    result?: unknown;
  }): Promise<void> {
    const current = this.snapshots.get(input.sessionKey)
      ?? await this.begin(input);
    if (current.idempotencyKey !== input.idempotencyKey) return;
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
    const current = this.snapshots.get(input.sessionKey);
    if (!current || current.idempotencyKey !== input.idempotencyKey) return;
    if (input.uncertain) {
      const uncertain = { ...current, phase: 'uncertain' as const, error: null };
      this.snapshots.set(input.sessionKey, uncertain);
      await this.persist(uncertain, true);
      this.scheduleRecovery(input.sessionKey, Date.now());
      return;
    }
    await this.publish({ ...current, error: input.error }, 'run.failed', { error: input.error }, true);
  }

  async aborting(sessionKey: string): Promise<void> {
    const current = this.snapshots.get(sessionKey);
    if (!current || isTerminalChatRunPhase(current.phase)) return;
    const next = { ...current, phase: 'aborting' as const, updatedAt: Date.now() };
    this.snapshots.set(sessionKey, next);
    await this.persist(next, true);
  }

  async aborted(sessionKey: string, runId?: string | null): Promise<void> {
    const current = this.snapshots.get(sessionKey);
    if (!current || (runId && current.runId && runId !== current.runId)) return;
    await this.publish(current, 'run.aborted', undefined, true);
  }

  async abortFailed(sessionKey: string, error: string): Promise<void> {
    const current = this.snapshots.get(sessionKey);
    if (!current || current.phase !== 'aborting') return;
    const next = { ...current, phase: 'running' as const, error, updatedAt: Date.now() };
    this.snapshots.set(sessionKey, next);
    await this.persist(next, true);
  }

  async handleEngineEvent(event: NormalizedEngineEvent, engineType?: AgentEngineType): Promise<void> {
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
    const canonicalType = event.type === 'message.final' && event.message == null
      ? 'run.awaiting_transcript'
      : eventType;
    await this.publish({
      ...current,
      runId: event.runId ?? current.runId,
      engineType: engineType ?? current.engineType,
      error: current.error,
    }, canonicalType, payload, canonicalType.startsWith('run.'));

    const latest = this.snapshots.get(sessionKey);
    if (event.type === 'message.final' && latest) {
      const message = getRecord(event.message);
      const phaseIsCompleted = event.phase === 'completed';
      const role = String(message?.role ?? '').toLowerCase();
      const openClawTerminal = latest.engineType === 'openclaw'
        && role === 'assistant'
        && hasAssistantOutput(message)
        && !hasTrailingPendingToolUse(message);
      if (phaseIsCompleted || openClawTerminal) {
        await this.publish(latest, 'run.completed', {
          reconcileReason: phaseIsCompleted ? 'message-final-completed-phase' : 'openclaw-assistant-final',
        }, true);
      }
    }
  }

  private async publish(
    base: ChatRuntimeSnapshot,
    type: CanonicalChatEventType,
    payload?: unknown,
    forcePersist = false,
  ): Promise<void> {
    const now = Date.now();
    const phase = phaseForEvent(type, base.phase);
    const snapshot: ChatRuntimeSnapshot = {
      ...base,
      phase,
      sequence: base.sequence + 1,
      lastEventAt: now,
      terminalAt: isTerminalChatRunPhase(phase) ? now : null,
      updatedAt: now,
    };
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
    logger.info('[chat-runtime]', {
      sessionKey: snapshot.sessionKey,
      runId: snapshot.runId,
      idempotencyKey: snapshot.idempotencyKey,
      eventType: type,
      phase,
      epoch: snapshot.epoch,
      sequence: snapshot.sequence,
    });
  }

  private async persist(snapshot: ChatRuntimeSnapshot, force: boolean): Promise<void> {
    const now = Date.now();
    const last = this.lastPersistedAt.get(snapshot.sessionKey) ?? 0;
    if (!force && now - last < DELTA_PERSIST_THROTTLE_MS) return;
    this.lastPersistedAt.set(snapshot.sessionKey, now);
    try {
      await getChatRuntimeRepository().upsert(snapshot);
    } catch (error) {
      logger.warn('[chat-runtime] persist failed', { sessionKey: snapshot.sessionKey, error });
    }
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
      // OpenClaw chat.history currently has no isRunning field. Transcript
      // projection is still valid; only runtime reconciliation needs this flag.
      if (typeof historyResult.isRunning !== 'boolean') return;
      if (historyResult.isRunning) {
        const next = { ...latest, phase: 'running' as const, error: null, updatedAt: Date.now() };
        this.snapshots.set(sessionKey, next);
        await this.persist(next, true);
      } else if (historyHasCompletedTurn(historyResult.messages)) {
        await this.publish(latest, 'run.completed', { reconcileReason: 'history-not-running' }, true);
      } else if (latest.phase !== 'awaiting_transcript') {
        const next = { ...latest, phase: 'reconciling' as const, updatedAt: Date.now() };
        this.snapshots.set(sessionKey, next);
        await this.persist(next, true);
      }
    } catch (error) {
      logger.debug('[chat-runtime] reconcile deferred', { sessionKey, error: String(error) });
    }
  }

  private async projectCurrentTranscript(snapshot: ChatRuntimeSnapshot, messages: unknown[]): Promise<void> {
    const turnMessages = currentRunTranscriptMessages(snapshot, messages);
    if (turnMessages.length === 0) return;
    let seen = this.projectedTranscriptEvents.get(snapshot.sessionKey);
    if (!seen) {
      seen = new Set<string>();
      this.projectedTranscriptEvents.set(snapshot.sessionKey, seen);
    }
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
      if (!latest || isTerminalChatRunPhase(latest.phase)) return;
      await this.publish(
        latest,
        role === 'assistant' ? 'message.delta' : 'tool.updated',
        message,
      );
    }
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
      void this.publish({ ...current, error }, 'run.failed', { error }, true);
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
      void this.interruptByPolicy(current, 'hard-deadline');
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
      // OpenClaw's live assistant buffer does not always include the persisted
      // reasoning/tool records. Project current-turn history even while deltas
      // are flowing so the canonical overlay stays chronologically complete.
      await this.reconcileSession(sessionKey, true);
      const latest = this.snapshots.get(sessionKey);
      if (latest && !isTerminalChatRunPhase(latest.phase)) {
        this.historyPollTimers.set(sessionKey, setTimeout(poll, HISTORY_POLL_INTERVAL_MS));
      }
    };
    this.historyPollTimers.set(sessionKey, setTimeout(poll, HISTORY_POLL_START_DELAY_MS));
  }

  private clearHistoryPoll(sessionKey: string): void {
    const timer = this.historyPollTimers.get(sessionKey);
    if (timer) clearTimeout(timer);
    this.historyPollTimers.delete(sessionKey);
  }
}

const supervisors = new WeakMap<GatewayManager, ChatRuntimeSupervisor>();

export function getChatRuntimeSupervisor(gatewayManager: GatewayManager): ChatRuntimeSupervisor {
  let supervisor = supervisors.get(gatewayManager);
  if (!supervisor) {
    supervisor = new ChatRuntimeSupervisor(gatewayManager);
    supervisors.set(gatewayManager, supervisor);
    void supervisor.initialize();
  }
  return supervisor;
}
