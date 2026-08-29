import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { access, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AgentSession,
  AgentSessionEvent,
} from '@earendil-works/pi-coding-agent';
import type {
  PiPromptResult,
  PiSessionConfig,
  PiWorkerMessage,
  PiWorkerRequest,
  SerializedPiError,
} from '../../shared/pi-runtime-protocol';
import type { NormalizedEngineEvent } from '../gateway/normalized-engine-event';
import {
  DEFAULT_MODEL_CONTEXT_WINDOW,
  DEFAULT_MODEL_MAX_TOKENS,
} from '../../shared/model-runtime-defaults';
import { abortPiActiveRun } from './abort-policy';
import {
  getPiAssistantDisplaySnapshot,
  getPiAssistantError,
  getPiModelCompat,
  getPiTranscriptRevision,
  shouldCompletePiRun,
  startPiAssistantSnapshot,
  updatePiAssistantSnapshot,
} from './event-policy';
import { KeyedTaskQueue } from './keyed-task-queue';
import { filterPiSkills } from './skill-policy';
import { buildPiEnabledToolNames } from './tool-policy';
import { buildPiAgentExtensions } from '../agent-extensions/adapters/pi';

type PiSession = {
  session: AgentSession;
  sessionId: string;
  sessionFile?: string;
  configKey: string;
  activeRunId?: string;
  settledRunId?: string;
  streamingAssistant?: Record<string, unknown> & { role: 'assistant'; content: Array<Record<string, unknown>> };
  unsubscribe: () => void;
};

type PiSdk = typeof import('@earendil-works/pi-coding-agent');
type PiPromptOptions = NonNullable<Parameters<AgentSession['prompt']>[1]>;
type PiPromptImages = NonNullable<PiPromptOptions['images']>;

const sessions = new Map<string, PiSession>();
const sessionCommandQueue = new KeyedTaskQueue();
let sdkPromise: Promise<PiSdk> | null = null;
const parentPort = (process as NodeJS.Process & {
  parentPort?: { on(event: 'message', listener: (event: { data: unknown }) => void): void; postMessage(value: unknown): void };
}).parentPort;

function logPiCore(stage: string, details: Record<string, unknown> = {}): void {
  console.info(`[pi-core] ${stage} ${JSON.stringify(details)}`);
}

function summarizeSessionConfig(config: PiSessionConfig): Record<string, unknown> {
  return {
    sessionKey: config.sessionKey,
    cwd: config.cwd,
    agentDir: config.agentDir,
    sessionDir: config.sessionDir,
    sessionFile: config.sessionFile ?? null,
    provider: config.model.provider,
    model: config.model.model,
    accountId: config.model.accountId ?? null,
    baseUrl: config.model.baseUrl ?? null,
    apiProtocol: config.model.apiProtocol ?? null,
    hasApiKey: Boolean(config.model.apiKey),
    headerNames: Object.keys(config.model.headers ?? {}),
    systemPromptChars: config.systemPrompt?.length ?? 0,
    media: (config.media ?? []).map((item) => ({
      fileName: item.fileName,
      mimeType: item.mimeType,
      filePath: item.filePath,
    })),
    scheduledAllowedRoots: config.scheduledAllowedRoots ?? [],
    skillRoots: config.skillRoots ?? [],
  };
}

function post(message: PiWorkerMessage): void {
  parentPort?.postMessage(message);
}

function loadPiSdk(): Promise<PiSdk> {
  const moduleName: string = '@earendil-works/pi-coding-agent';
  if (!sdkPromise) {
    const startedAt = Date.now();
    logPiCore('sdk.load.start', { moduleName });
    sdkPromise = (import(moduleName) as Promise<PiSdk>).then((sdk) => {
      logPiCore('sdk.load.ready', { moduleName, durationMs: Date.now() - startedAt });
      return sdk;
    }).catch((error: unknown) => {
      logPiCore('sdk.load.failed', { moduleName, durationMs: Date.now() - startedAt, error: serializeError(error).message });
      throw error;
    });
  }
  return sdkPromise;
}

function serializeError(error: unknown): SerializedPiError {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack, code: (error as Error & { code?: string }).code };
  }
  return { message: String(error) };
}

function respond(requestId: string, success: boolean, result?: unknown, error?: unknown): void {
  post({
    type: 'response',
    requestId,
    success,
    result,
    ...(error ? { error: serializeError(error) } : {}),
  });
}

function emit(sessionKey: string, event: NormalizedEngineEvent): void {
  post({ type: 'engine.event', sessionKey, event });
}

function configKey(config: PiSessionConfig): string {
  return JSON.stringify({
    cwd: config.cwd,
    sessionFile: config.sessionFile,
    provider: config.model.provider,
    model: config.model.model,
    baseUrl: config.model.baseUrl ?? '',
    apiProtocol: config.model.apiProtocol ?? '',
    headers: config.model.headers ?? {},
    credentialRevision: config.model.apiKey
      ? createHash('sha256').update(config.model.apiKey).digest('hex')
      : '',
    roots: config.scheduledAllowedRoots ?? [],
    skillRoots: config.skillRoots ?? [],
    systemPrompt: config.systemPrompt ?? '',
  });
}

async function createSession(config: PiSessionConfig): Promise<PiSession> {
  const startedAt = Date.now();
  logPiCore('session.create.start', summarizeSessionConfig(config));
  await Promise.all([mkdir(config.agentDir, { recursive: true }), mkdir(config.sessionDir, { recursive: true }), mkdir(config.cwd, { recursive: true })]);
  logPiCore('session.create.directories-ready', { sessionKey: config.sessionKey, durationMs: Date.now() - startedAt });
  const sdk = await loadPiSdk();
  const settingsManager = sdk.SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 2 },
  });
  const unifiedExtensions = await buildPiAgentExtensions({
    sessionKey: config.sessionKey,
    cwd: config.cwd,
    agentId: config.sessionKey.startsWith('agent:') ? config.sessionKey.split(':')[1] : 'main',
    model: config.model.model,
    accountId: config.model.accountId,
    mode: config.scheduledAllowedRoots?.length ? 'scheduled' : 'interactive',
    allowedRoots: config.scheduledAllowedRoots,
  });
  for (const diagnostic of unifiedExtensions.diagnostics) {
    logPiCore('extension.diagnostic', diagnostic as unknown as Record<string, unknown>);
  }
  const enabledToolNames = buildPiEnabledToolNames(unifiedExtensions.toolNames);
  logPiCore('extension.tools-enabled', {
    sessionKey: config.sessionKey,
    mode: config.scheduledAllowedRoots?.length ? 'scheduled' : 'interactive',
    toolCount: enabledToolNames.length,
    tools: enabledToolNames,
  });
  const managedContextPath = join(config.agentDir, 'AGENTS.md');
  const loader = new sdk.DefaultResourceLoader({
    cwd: config.cwd,
    agentDir: config.agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: false,
    additionalSkillPaths: config.skillRoots ?? [],
    skillsOverride: (current) => ({
      ...current,
      skills: filterPiSkills(current.skills, config.skillRoots ?? []),
    }),
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    agentsFilesOverride: () => ({
      agentsFiles: existsSync(managedContextPath)
        ? [{ path: managedContextPath, content: readFileSync(managedContextPath, 'utf-8') }]
        : [],
    }),
    appendSystemPrompt: [
      `SClaw default workspace: ${config.cwd}. For interactive sessions this is a default working directory, not an access boundary.`,
      config.systemPrompt ?? '',
    ].filter(Boolean),
    extensionFactories: unifiedExtensions.extensions,
  });
  await loader.reload();
  const loadedSkills = loader.getSkills();
  logPiCore('session.create.resources-ready', {
    sessionKey: config.sessionKey,
    skillCount: loadedSkills.skills.length,
    skills: loadedSkills.skills.map((skill) => skill.name),
    diagnosticCount: loadedSkills.diagnostics.length,
    hasManagedContext: existsSync(managedContextPath),
    durationMs: Date.now() - startedAt,
  });

  const modelRuntime = await sdk.ModelRuntime.create({
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  const providerId = config.model.provider;
  let model = modelRuntime.getModel(providerId, config.model.model);
  logPiCore('session.create.model-lookup', {
    sessionKey: config.sessionKey,
    provider: providerId,
    model: config.model.model,
    foundBuiltin: Boolean(model),
  });
  if (!model && config.model.baseUrl) {
    modelRuntime.registerProvider(providerId, {
      baseUrl: config.model.baseUrl,
      apiKey: config.model.apiKey || 'sclaw-runtime-key',
      api: config.model.apiProtocol ?? 'openai-completions',
      headers: config.model.headers,
      models: [{
        id: config.model.model,
        name: config.model.model,
        reasoning: false,
        input: ['text', 'image'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: DEFAULT_MODEL_CONTEXT_WINDOW,
        maxTokens: DEFAULT_MODEL_MAX_TOKENS,
        compat: getPiModelCompat(config.model.apiProtocol),
      }],
    });
    model = modelRuntime.getModel(providerId, config.model.model);
    logPiCore('session.create.provider-registered', {
      sessionKey: config.sessionKey,
      provider: providerId,
      model: config.model.model,
      baseUrl: config.model.baseUrl,
      apiProtocol: config.model.apiProtocol ?? 'openai-completions',
    });
  }
  if (config.model.apiKey) {
    await modelRuntime.setRuntimeApiKey(providerId, config.model.apiKey);
    logPiCore('session.create.runtime-key-set', { sessionKey: config.sessionKey, provider: providerId });
  }
  if (!model) throw new Error(`Pi model not found: ${providerId}/${config.model.model}`);

  const resumesExistingSession = Boolean(config.sessionFile);
  const sessionManager = config.sessionFile
    ? sdk.SessionManager.open(config.sessionFile, config.sessionDir, config.cwd)
    : sdk.SessionManager.create(config.cwd, config.sessionDir);
  logPiCore('session.create.session-manager-ready', {
    sessionKey: config.sessionKey,
    mode: resumesExistingSession ? 'open' : 'create',
    sessionFile: config.sessionFile ?? null,
  });
  const { session } = await sdk.createAgentSession({
    cwd: config.cwd,
    agentDir: config.agentDir,
    model,
    modelRuntime,
    settingsManager,
    resourceLoader: loader,
    sessionManager,
    tools: enabledToolNames,
  });

  const entry: PiSession = {
    session,
    sessionId: session.sessionId,
    sessionFile: session.sessionFile,
    configKey: configKey(config),
    unsubscribe: () => {},
  };
  entry.unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    const runId = entry.activeRunId;
    if (!runId) return;
    switch (event?.type) {
      case 'agent_start':
        logPiCore('event.agent-start', { sessionKey: config.sessionKey, runId });
        emit(config.sessionKey, { type: 'turn.started', sessionKey: config.sessionKey, runId });
        break;
      case 'message_start':
        logPiCore('event.message-start', {
          sessionKey: config.sessionKey,
          runId,
          role: event.message.role,
        });
        entry.streamingAssistant = startPiAssistantSnapshot(event.message, `pi-stream-${runId}`);
        break;
      case 'message_update': {
        entry.streamingAssistant = updatePiAssistantSnapshot(
          entry.streamingAssistant,
          event.assistantMessageEvent,
          `pi-stream-${runId}`,
        );
        if (entry.streamingAssistant) {
          const displaySnapshot = getPiAssistantDisplaySnapshot(
            entry.streamingAssistant,
            event.assistantMessageEvent,
          );
          emit(config.sessionKey, {
            type: 'message.delta', sessionKey: config.sessionKey, runId,
            message: displaySnapshot ?? entry.streamingAssistant,
          });
        }
        break;
      }
      case 'message_end': {
        const message = event.message;
        logPiCore('event.message-end', {
          sessionKey: config.sessionKey,
          runId,
          role: message.role,
          stopReason: message.role === 'assistant' ? message.stopReason : undefined,
        });
        if (message?.role === 'assistant') {
          const errorMessage = getPiAssistantError(message);
          if (errorMessage) {
            emit(config.sessionKey, {
              type: 'turn.failed', sessionKey: config.sessionKey, runId, errorMessage,
            });
            entry.activeRunId = undefined;
            entry.settledRunId = undefined;
            entry.streamingAssistant = undefined;
            break;
          }
          emit(config.sessionKey, { type: 'message.final', sessionKey: config.sessionKey, runId, message });
          entry.streamingAssistant = undefined;
        } else if (message.role === 'toolResult') {
          emit(config.sessionKey, { type: 'tool.result', sessionKey: config.sessionKey, runId, message });
        }
        break;
      }
      case 'agent_settled':
        // Complete from the matching prompt promise. The official SDK resolves
        // that promise only after agent_settled and all listeners have finished.
        entry.settledRunId = runId;
        logPiCore('event.agent-settled', { sessionKey: config.sessionKey, runId });
        break;
    }
  });
  logPiCore('session.create.ready', {
    sessionKey: config.sessionKey,
    sessionId: entry.sessionId,
    sessionFile: entry.sessionFile ?? null,
    resumed: resumesExistingSession,
    messageCount: session.messages.length,
    durationMs: Date.now() - startedAt,
  });
  return entry;
}

async function ensureSession(config: PiSessionConfig): Promise<PiSession> {
  const existing = sessions.get(config.sessionKey);
  const nextKey = configKey(config);
  if (existing?.configKey === nextKey) {
    logPiCore('session.ensure.reuse', { sessionKey: config.sessionKey, sessionId: existing.sessionId });
    return existing;
  }
  if (existing?.activeRunId) throw new Error(`Pi session is currently running: ${config.sessionKey}`);
  if (existing) {
    logPiCore('session.ensure.replace', {
      sessionKey: config.sessionKey,
      sessionId: existing.sessionId,
      reason: 'configuration-changed',
    });
    existing.unsubscribe();
    existing.session.dispose();
    sessions.delete(config.sessionKey);
  }
  const created = await createSession(config);
  sessions.set(config.sessionKey, created);
  logPiCore('session.ensure.stored', { sessionKey: config.sessionKey, sessionId: created.sessionId, sessionCount: sessions.size });
  return created;
}

async function handle(request: PiWorkerRequest): Promise<void> {
  const payload = request.payload ?? {};
  const commandStartedAt = Date.now();
  logPiCore('command.received', {
    requestId: request.requestId,
    command: request.command,
    sessionKey: request.sessionKey ?? null,
    payloadKeys: Object.keys(payload),
  });
  switch (request.command) {
    case 'runtime.initialize':
      respond(request.requestId, true, { ready: true });
      logPiCore('command.completed', { requestId: request.requestId, command: request.command, durationMs: Date.now() - commandStartedAt });
      return;
    case 'session.open': {
      const entry = await ensureSession(payload.config as unknown as PiSessionConfig);
      respond(request.requestId, true, { sessionId: entry.sessionId, sessionFile: entry.sessionFile });
      logPiCore('command.completed', { requestId: request.requestId, command: request.command, sessionKey: request.sessionKey ?? null, durationMs: Date.now() - commandStartedAt });
      return;
    }
    case 'session.prompt': {
      const config = payload.config as unknown as PiSessionConfig;
      const entry = await ensureSession(config);
      if (entry.activeRunId) throw new Error(`Pi session is already running: ${config.sessionKey}`);
      // Skill installs/enables can change without changing the session config.
      // Reload while idle so every turn sees the current SClaw-managed skill set.
      const reloadStartedAt = Date.now();
      await entry.session.reload();
      logPiCore('session.prompt.resources-reloaded', {
        sessionKey: config.sessionKey,
        durationMs: Date.now() - reloadStartedAt,
      });
      const runId = String(payload.runId || randomUUID());
      entry.activeRunId = runId;
      entry.settledRunId = undefined;
      entry.streamingAssistant = undefined;
      const result: PiPromptResult = { runId, sessionId: entry.sessionId, sessionFile: entry.sessionFile };
      respond(request.requestId, true, result);
      logPiCore('session.prompt.accepted', {
        requestId: request.requestId,
        sessionKey: config.sessionKey,
        runId,
        messageChars: String(payload.message ?? '').length,
        mediaCount: config.media?.length ?? 0,
        durationMs: Date.now() - commandStartedAt,
      });
      const images: PiPromptImages = await Promise.all((config.media ?? []).map(async (media) => ({
        type: 'image', data: (await readFile(media.filePath)).toString('base64'), mimeType: media.mimeType,
      })));
      void entry.session.prompt(String(payload.message ?? ''), { images, source: 'rpc' })
        .then(() => {
          if (!shouldCompletePiRun(entry.activeRunId, entry.settledRunId, runId)) return;
          logPiCore('session.prompt.completed', { sessionKey: config.sessionKey, runId });
          emit(config.sessionKey, { type: 'turn.completed', sessionKey: config.sessionKey, runId });
          entry.activeRunId = undefined;
          entry.settledRunId = undefined;
          entry.streamingAssistant = undefined;
        })
        .catch((error: unknown) => {
          if (entry.activeRunId !== runId) return;
          logPiCore('session.prompt.failed', { sessionKey: config.sessionKey, runId, error: serializeError(error).message });
          emit(config.sessionKey, { type: 'turn.failed', sessionKey: config.sessionKey, runId, errorMessage: serializeError(error).message });
          entry.activeRunId = undefined;
          entry.settledRunId = undefined;
          entry.streamingAssistant = undefined;
        });
      return;
    }
    case 'session.abort': {
      const entry = request.sessionKey ? sessions.get(request.sessionKey) : undefined;
      logPiCore('session.abort.start', { sessionKey: request.sessionKey ?? null, activeRunId: entry?.activeRunId ?? null });
      await abortPiActiveRun(entry, {
        emitAborted: (runId) => emit(request.sessionKey!, {
          type: 'turn.aborted', sessionKey: request.sessionKey, runId,
        }),
        respond: (aborted, runId) => {
          respond(request.requestId, true, {
            aborted,
            runIds: aborted && runId ? [runId] : [],
          });
          logPiCore('session.abort.accepted', {
            requestId: request.requestId,
            sessionKey: request.sessionKey ?? null,
            aborted,
            runId: runId ?? null,
            durationMs: Date.now() - commandStartedAt,
          });
        },
      });
      return;
    }
    case 'session.history': {
      const config = payload.config as unknown as PiSessionConfig;
      // A history read must never replace a live in-memory session. Send-time
      // system context (for example injected Memory) can differ from the base
      // config used by chat.history; reopening here races Pi's final JSONL flush
      // and briefly projects a stale transcript over the completed live reply.
      const entry = sessions.get(config.sessionKey) ?? await ensureSession(config);
      respond(request.requestId, true, { messages: entry.session.messages, isRunning: Boolean(entry.activeRunId) });
      logPiCore('session.history.completed', {
        sessionKey: config.sessionKey,
        messageCount: entry.session.messages.length,
        isRunning: Boolean(entry.activeRunId),
        durationMs: Date.now() - commandStartedAt,
      });
      return;
    }
    case 'session.inspect': {
      const entry = request.sessionKey ? sessions.get(request.sessionKey) : undefined;
      if (!entry) {
        respond(request.requestId, true, { status: 'not_started' });
        logPiCore('session.inspect.completed', { sessionKey: request.sessionKey ?? null, status: 'not_started' });
        return;
      }
      const messages = entry.session.messages as unknown[];
      respond(request.requestId, true, {
        status: entry.activeRunId ? 'active' : 'completed',
        ...(entry.activeRunId ? { runId: entry.activeRunId } : {}),
        currentTurnMessages: messages,
        transcriptRevision: getPiTranscriptRevision(messages),
      });
      logPiCore('session.inspect.completed', {
        sessionKey: request.sessionKey ?? null,
        status: entry.activeRunId ? 'active' : 'completed',
        runId: entry.activeRunId ?? null,
        messageCount: messages.length,
      });
      return;
    }
    case 'session.delete': {
      const entry = request.sessionKey ? sessions.get(request.sessionKey) : undefined;
      if (entry) {
        logPiCore('session.delete.dispose', { sessionKey: request.sessionKey ?? null, sessionId: entry.sessionId });
        await entry.session.abort().catch(() => {});
        entry.unsubscribe();
        entry.session.dispose();
        sessions.delete(request.sessionKey!);
      }
      const sessionFile = typeof payload.sessionFile === 'string' ? payload.sessionFile : undefined;
      if (sessionFile) await rm(sessionFile, { force: true });
      respond(request.requestId, true, { deleted: true });
      logPiCore('session.delete.completed', { sessionKey: request.sessionKey ?? null, sessionFile: sessionFile ?? null, sessionCount: sessions.size });
      return;
    }
    case 'runtime.shutdown':
      logPiCore('runtime.shutdown.start', { sessionCount: sessions.size });
      for (const entry of sessions.values()) {
        await entry.session.abort().catch(() => {});
        entry.unsubscribe();
        entry.session.dispose();
      }
      sessions.clear();
      respond(request.requestId, true, { stopped: true });
      logPiCore('runtime.shutdown.completed');
      process.exit(0);
  }
}

parentPort?.on('message', (event) => {
  const request = event.data as PiWorkerRequest;
  const sessionKey = request.sessionKey?.trim();
  const operation = sessionKey
    ? sessionCommandQueue.run(sessionKey, () => handle(request))
    : handle(request);
  void operation.catch((error) => {
    logPiCore('command.failed', {
      requestId: request.requestId,
      command: request.command,
      sessionKey: request.sessionKey ?? null,
      error: serializeError(error).message,
    });
    respond(request.requestId, false, undefined, error);
  });
});

logPiCore('runtime.bootstrap.start', { cwd: process.cwd(), pid: process.pid });
void Promise.all([access(process.cwd()), stat(process.cwd()), loadPiSdk()])
  .then(() => {
    logPiCore('runtime.bootstrap.ready', { cwd: process.cwd(), pid: process.pid });
    post({ type: 'runtime.ready' });
  })
  .catch((error) => {
    logPiCore('runtime.bootstrap.failed', { error: serializeError(error).message });
    post({ type: 'runtime.failed', error: serializeError(error) });
  });
