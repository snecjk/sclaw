import type { OpenClawPluginApi } from "./api.js";
import { rememberToolCommand, mergeToolParams } from "./command-cache.js";
import { buildToolCommandPayload } from "./command-extract.js";
import { resolveTelemetryConfig, validateTelemetryConfig } from "./config.js";
import {
  postConversationBatchWithRetries,
  resolveConversationBatchUrl,
} from "./conversation-ingest.js";
import { createTelemetryPipeline } from "./pipeline.js";
import {
  clearSessionRunCache,
  getCachedRunId,
  queuePendingAgentRunEnd,
  queuePendingModelCall,
  queuePendingModelEnded,
  rememberRunId,
  shiftPendingModelCall,
  takePendingAgentRunEnd,
  takePendingModelCalls,
  takePendingModelEnded,
} from "./run-id-cache.js";
import { logFinanceCliAfter, logFinanceCliBefore } from "./finance-cli-debug-log.js";
import { pickToolResult } from "./tool-result-extract.js";
import { resolveLastTurnRunIdForSync } from "./transcript-sync.js";
import type { TelemetryEnvelope } from "./types.js";

const TAG = "sto-agent-telemetry";

/** 对话同步占位 runId，不能用于行为遥测 correlation */
function isSyntheticTelemetryRunId(runId: string): boolean {
  return runId.includes(":turn:") || runId.endsWith(":agent_end");
}

function resolveTelemetryRunId(params: {
  sessionKey?: string;
  sessionId?: string;
  ctxRunId?: string;
  eventRunId?: string;
}): string | undefined {
  const candidates = [
    getCachedRunId(params.sessionKey),
    getCachedRunId(params.sessionId),
    params.ctxRunId,
    params.eventRunId,
  ];
  for (const candidate of candidates) {
    const id = typeof candidate === "string" ? candidate.trim() : "";
    if (id && !isSyntheticTelemetryRunId(id)) {
      return id;
    }
  }
  return undefined;
}

function rememberRunIdForSession(
  sessionKey: string | undefined,
  sessionId: string | undefined,
  runId: string | undefined,
): void {
  rememberRunId(sessionKey, runId);
  rememberRunId(sessionId, runId);
}

function sessionCacheKey(sessionKey: string | undefined, sessionId: string): string {
  return sessionKey?.trim() || sessionId;
}

function pickRunIdFromAgentEndEvent(event: unknown): string | undefined {
  if (!event || typeof event !== "object") {
    return undefined;
  }
  const record = event as Record<string, unknown>;
  for (const key of ["runId", "run_id"]) {
    const value = record[key];
    if (typeof value === "string") {
      const id = value.trim();
      if (id && !isSyntheticTelemetryRunId(id)) {
        return id;
      }
    }
  }
  return undefined;
}

function slimAgentCtx(ctx: {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
  toolCallId?: string;
  toolName?: string;
  channelId?: string;
}) {
  return {
    agentId: ctx.agentId,
    sessionKey: ctx.sessionKey,
    sessionId: ctx.sessionId,
    runId: ctx.runId,
    toolCallId: ctx.toolCallId,
    toolName: ctx.toolName,
    channelId: ctx.channelId,
  };
}

function requireCorrelation(
  ctx: {
    agentId?: string;
    sessionKey?: string;
    sessionId?: string;
    runId?: string;
    toolCallId?: string;
    toolName?: string;
    channelId?: string;
  },
  event: { runId?: string; sessionId?: string },
  options?: { syntheticRunId?: string },
): TelemetryEnvelope["correlation"] | null {
  const sessionId = event.sessionId ?? ctx.sessionId;
  const runId = event.runId ?? ctx.runId ?? options?.syntheticRunId;
  if (!sessionId || !runId) {
    return null;
  }
  return {
    agentId: ctx.agentId,
    sessionKey: ctx.sessionKey,
    sessionId,
    runId,
    toolCallId: ctx.toolCallId,
    toolName: ctx.toolName,
    channelId: ctx.channelId,
  };
}

function pickToolParams(event: Record<string, unknown>): Record<string, unknown> | undefined {
  const direct = event.params;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as Record<string, unknown>;
  }
  const input = event.input;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return undefined;
}

function toolEventData(event: {
  toolName?: string;
  runId?: string;
  toolCallId?: string;
  params?: Record<string, unknown>;
  command?: string;
  durationMs?: number;
  error?: unknown;
  result?: unknown;
  rawEvent?: Record<string, unknown>;
}) {
  const cli = buildToolCommandPayload(event);
  const params =
    event.params && Object.keys(event.params).length > 0
      ? event.params
      : cli?.eventParams;
  const result =
    event.result ??
    (event.rawEvent ? pickToolResult(event.rawEvent) : undefined);
  return {
    event: {
      toolName: event.toolName,
      runId: event.runId,
      toolCallId: event.toolCallId,
      ...(params ? { params } : {}),
      ...(result !== undefined ? { result } : {}),
      ...(event.durationMs != null ? { durationMs: event.durationMs } : {}),
      ...(event.error != null ? { error: event.error } : {}),
    },
    ...(cli?.toolHint ? { toolHint: cli.toolHint } : {}),
    ...(event.rawEvent ? { rawEvent: event.rawEvent } : {}),
  };
}

function emitModelCallStartedEvent(
  pipeline: ReturnType<typeof createTelemetryPipeline>,
  runId: string,
  event: { sessionKey?: string; sessionId?: string; runId?: string },
  ctx: {
    agentId?: string;
    sessionKey?: string;
    sessionId?: string;
    runId?: string;
    channelId?: string;
  },
): void {
  const sessionId = event.sessionId ?? ctx.sessionId;
  if (!sessionId) return;
  const correlation = requireCorrelation(ctx, event, { syntheticRunId: runId });
  if (!correlation) return;
  pipeline.emit({
    nativeHook: "model_call_started",
    correlation: {
      ...correlation,
      runId,
      sessionKey: ctx.sessionKey ?? event.sessionKey,
      sessionId,
    },
    data: { event, agentContext: slimAgentCtx(ctx) },
  });
}

function flushPendingModelCalls(
  pipeline: ReturnType<typeof createTelemetryPipeline>,
  sessionKey: string | undefined,
  runId: string,
): void {
  for (const pending of takePendingModelCalls(sessionKey)) {
    emitModelCallStartedEvent(pipeline, runId, pending.event as { sessionKey?: string; sessionId?: string; runId?: string }, pending.ctx);
  }
}

function pickModelDurationMs(event: {
  durationMs?: number;
  latencyMs?: number;
}): number | undefined {
  if (typeof event.durationMs === "number") {
    return event.durationMs;
  }
  if (typeof event.latencyMs === "number") {
    return event.latencyMs;
  }
  return undefined;
}

function emitModelCallEndedEvent(
  pipeline: ReturnType<typeof createTelemetryPipeline>,
  runId: string,
  pending: {
    sessionId: string;
    sessionKey?: string;
    event: unknown;
    ctx: {
      agentId?: string;
      sessionKey?: string;
      sessionId?: string;
      channelId?: string;
    };
    durationMs?: number;
  },
  nativeHook: "model_call_ended" | "llm_output" = "model_call_ended",
): void {
  const event = pending.event as { sessionKey?: string; sessionId?: string; runId?: string };
  const correlation = requireCorrelation(pending.ctx, event, { syntheticRunId: runId });
  if (!correlation) return;
  pipeline.emit({
    nativeHook,
    correlation: {
      ...correlation,
      runId,
      sessionKey: pending.ctx.sessionKey ?? event.sessionKey,
      sessionId: pending.sessionId,
    },
    outcome: pending.durationMs != null ? { durationMs: pending.durationMs } : undefined,
    data: { event: pending.event, agentContext: slimAgentCtx(pending.ctx) },
  });
}

function pairPendingModelStart(
  pipeline: ReturnType<typeof createTelemetryPipeline>,
  sessionKey: string | undefined,
  runId: string,
): void {
  const pending = shiftPendingModelCall(sessionKey);
  if (!pending) return;
  emitModelCallStartedEvent(
    pipeline,
    runId,
    pending.event as { sessionKey?: string; sessionId?: string; runId?: string },
    pending.ctx,
  );
}

function handleModelCallEnded(
  pipeline: ReturnType<typeof createTelemetryPipeline>,
  event: { sessionKey?: string; sessionId?: string; runId?: string },
  ctx: {
    agentId?: string;
    sessionKey?: string;
    sessionId?: string;
    runId?: string;
    channelId?: string;
  },
  nativeHook: "model_call_ended" | "llm_output",
  durationMs?: number,
): void {
  const sessionId = event.sessionId ?? ctx.sessionId;
  if (!sessionId) return;

  const sessionKey = ctx.sessionKey ?? event.sessionKey;
  const runId = resolveTelemetryRunId({
    sessionKey,
    sessionId,
    ctxRunId: ctx.runId,
    eventRunId: event.runId,
  });

  if (runId) {
    rememberRunIdForSession(sessionKey, sessionId, runId);
    if (sessionKey) {
      pairPendingModelStart(pipeline, sessionKey, runId);
    }
  }

  if (!runId) {
    if (sessionKey) {
      queuePendingModelEnded(sessionKey, {
        sessionId,
        sessionKey,
        event,
        ctx,
        durationMs,
      });
    }
    return;
  }

  emitModelCallEndedEvent(
    pipeline,
    runId,
    {
      sessionId,
      sessionKey,
      event,
      ctx,
      durationMs,
    },
    nativeHook,
  );

  const cacheKey = sessionCacheKey(sessionKey, sessionId);
  if (sessionKey) {
    flushPendingModelCalls(pipeline, sessionKey, runId);
    flushPendingModelEnded(pipeline, sessionKey, runId);
  }
  if (flushPendingAgentRunEnd(pipeline, cacheKey, runId)) {
    clearSessionRunCache(sessionKey, sessionId);
  }
}

function flushPendingModelEnded(
  pipeline: ReturnType<typeof createTelemetryPipeline>,
  sessionKey: string | undefined,
  runId: string,
): void {
  for (const pending of takePendingModelEnded(sessionKey)) {
    emitModelCallEndedEvent(pipeline, runId, pending, "model_call_ended");
  }
}

function emitAgentRunEndEvent(
  pipeline: ReturnType<typeof createTelemetryPipeline>,
  runId: string,
  pending: {
    sessionId: string;
    sessionKey?: string;
    event: unknown;
    ctx: {
      agentId?: string;
      sessionKey?: string;
      sessionId?: string;
      channelId?: string;
    };
  },
): void {
  const correlation: TelemetryEnvelope["correlation"] = {
    agentId: pending.ctx.agentId,
    sessionKey: pending.ctx.sessionKey ?? pending.sessionKey,
    sessionId: pending.sessionId,
    runId,
    channelId: pending.ctx.channelId,
  };
  pipeline.emit({
    nativeHook: "agent_end",
    correlation,
    data: { event: pending.event, agentContext: slimAgentCtx(pending.ctx) },
  });
}

function flushPendingAgentRunEnd(
  pipeline: ReturnType<typeof createTelemetryPipeline>,
  cacheKey: string | undefined,
  runId: string,
): boolean {
  const pending = takePendingAgentRunEnd(cacheKey);
  if (!pending) return false;
  emitAgentRunEndEvent(pipeline, runId, pending);
  return true;
}

function bindRunIdFromToolHook(
  pipeline: ReturnType<typeof createTelemetryPipeline>,
  ctx: { sessionKey?: string; sessionId?: string; runId?: string },
): void {
  const sessionKey = ctx.sessionKey;
  const runId = ctx.runId;
  if (!sessionKey || !runId) return;
  rememberRunIdForSession(sessionKey, ctx.sessionId, runId);
  flushPendingModelCalls(pipeline, sessionKey, runId);
  flushPendingModelEnded(pipeline, sessionKey, runId);
}

export function registerAgentTelemetry(api: OpenClawPluginApi): void {
  const cfg = resolveTelemetryConfig(api.pluginConfig);
  const validationError = validateTelemetryConfig(cfg);
  if (validationError) {
    api.logger.warn?.(validationError);
    return;
  }
  if (!cfg.enabled) {
    api.logger.info?.(`[${TAG}] plugin disabled`);
    return;
  }

  const pipeline = createTelemetryPipeline(api, cfg);
  const { hooks } = cfg;

  api.logger.info?.(`[${TAG}] registering hooks ingestUrl=${cfg.ingestUrl}`);

  if (hooks.beforeToolCall) {
    api.on(
      "before_tool_call",
      (event, ctx) => {
        // 仅本地：runId 缓存 + sai-cli 命令缓存；不上报（after_tool_call 已含入参/出参/耗时）
        const runId = ctx.runId ?? event.runId;
        if (ctx.sessionKey && runId) {
          bindRunIdFromToolHook(pipeline, ctx);
        } else if (!runId) {
          api.logger.warn?.(`[${TAG}] before_tool_call: missing runId (local cache only)`);
        }

        const toolCallId = event.toolCallId ?? ctx.toolCallId;
        const rawEvent =
          event && typeof event === "object" ? (event as Record<string, unknown>) : undefined;
        const toolParams = event.params ?? (rawEvent ? pickToolParams(rawEvent) : undefined);
        rememberToolCommand(toolCallId, {
          params: toolParams,
          command: event.command,
        });
        logFinanceCliBefore(api.logger, {
          toolName: event.toolName,
          toolCallId,
          params: toolParams,
          command: event.command,
        });
      },
      { priority: -100 },
    );
  }

  if (hooks.afterToolCall) {
    api.on(
      "after_tool_call",
      (event, ctx) => {
        const rawEvent =
          event && typeof event === "object" ? (event as Record<string, unknown>) : undefined;
        const toolCallId = event.toolCallId ?? ctx.toolCallId;
        const mergedParams = mergeToolParams(
          toolCallId,
          event.params ?? (rawEvent ? pickToolParams(rawEvent) : undefined),
        );
        const toolResult =
          (event as { result?: unknown }).result ??
          (rawEvent ? pickToolResult(rawEvent) : undefined);
        // Debug log even when telemetry correlation is missing.
        logFinanceCliAfter(api.logger, {
          toolName: event.toolName,
          toolCallId,
          params: mergedParams,
          command: event.command,
          result: toolResult,
          error: event.error ?? null,
          durationMs: event.durationMs,
          rawEvent,
        });

        const correlation = requireCorrelation(ctx, event);
        if (!correlation) {
          api.logger.warn?.(`[${TAG}] skip after_tool_call: missing sessionId/runId`);
          return;
        }
        bindRunIdFromToolHook(pipeline, ctx);
        correlation.toolCallId = toolCallId;
        correlation.toolName = event.toolName;
        const hasError = Boolean(event.error);
        pipeline.emit({
          nativeHook: "after_tool_call",
          correlation,
          outcome: {
            success: !hasError,
            durationMs: typeof event.durationMs === "number" ? event.durationMs : undefined,
            errorMessage: hasError ? String(event.error) : null,
          },
          data: {
            ...toolEventData({
              toolName: event.toolName,
              runId: event.runId,
              toolCallId: event.toolCallId,
              params: mergedParams,
              durationMs: event.durationMs,
              error: event.error ?? null,
              result: toolResult,
              rawEvent,
            }),
            toolContext: slimAgentCtx(ctx),
          },
        });
      },
      { priority: -100 },
    );
  }

  if (hooks.modelCallStarted) {
    const handleModelCallStarted = (
      event: { sessionKey?: string; sessionId?: string; runId?: string },
      ctx: {
        agentId?: string;
        sessionKey?: string;
        sessionId?: string;
        runId?: string;
        toolCallId?: string;
        toolName?: string;
        channelId?: string;
      },
      nativeHook: "model_call_started" | "before_prompt_build",
    ) => {
      const sessionId = event.sessionId ?? ctx.sessionId;
      if (!sessionId) return;

      const sessionKey = ctx.sessionKey ?? event.sessionKey;
      const runId =
        ctx.runId ??
        event.runId ??
        getCachedRunId(sessionKey);

      if (runId) {
        rememberRunIdForSession(sessionKey, sessionId, runId);
        emitModelCallStartedEvent(pipeline, runId, event, ctx);
        return;
      }

      // 0322 before_prompt_build：尚无 runId，等首次 tool hook 或 agent_end 再 flush
      if (nativeHook === "before_prompt_build" && sessionKey) {
        queuePendingModelCall(sessionKey, { sessionId, sessionKey, event, ctx });
        return;
      }

      api.logger.warn?.(`[${TAG}] skip model_call_started: missing runId session=${sessionId}`);
    };

    // OpenClaw 2026.5+ native hook（自带 runId）
    api.on("model_call_started", (event, ctx) => {
      handleModelCallStarted(event, ctx, "model_call_started");
    });
    // OpenClaw 2026.3.x fallback（log 分支 0322）
    api.on("before_prompt_build", (event, ctx) => {
      handleModelCallStarted(event, ctx, "before_prompt_build");
    });
  }

  if (hooks.modelCallEnded) {
    // OpenClaw 2026.5+ native hook
    api.on("model_call_ended", (event, ctx) => {
      const durationMs = pickModelDurationMs(event as { durationMs?: number; latencyMs?: number });
      handleModelCallEnded(pipeline, event, ctx, "model_call_ended", durationMs);
    });
    // OpenClaw 2026.3.x（0322）：模型出参在 llm_output
    api.on("llm_output", (event, ctx) => {
      handleModelCallEnded(pipeline, event, ctx, "llm_output");
    });
  }

  if (hooks.agentEnd) {
    api.on("agent_end", (event, ctx) => {
      void (async () => {
        const sessionId = event.sessionId ?? ctx.sessionId;
        if (!sessionId) {
          api.logger.warn?.(`[${TAG}] skip agent_end: missing sessionId`);
          return;
        }

        const sessionKey = ctx.sessionKey ?? event.sessionKey;
        const cacheKey = sessionCacheKey(sessionKey, sessionId);

        const telemetryRunId = resolveTelemetryRunId({
          sessionKey,
          sessionId,
          ctxRunId: ctx.runId,
          eventRunId: event.runId ?? pickRunIdFromAgentEndEvent(event),
        });

        queuePendingAgentRunEnd(cacheKey, {
          sessionId,
          sessionKey,
          event,
          ctx,
        });

        let agentEndFlushed = false;
        if (telemetryRunId && sessionKey) {
          flushPendingModelCalls(pipeline, sessionKey, telemetryRunId);
          flushPendingModelEnded(pipeline, sessionKey, telemetryRunId);
          agentEndFlushed = flushPendingAgentRunEnd(pipeline, cacheKey, telemetryRunId);
        }

        const syncRunId = await resolveLastTurnRunIdForSync({
          agentId: ctx.agentId,
          sessionId,
          sessionKey,
          explicitRunId:
            telemetryRunId ??
            ctx.runId ??
            event.runId ??
            getCachedRunId(sessionKey) ??
            getCachedRunId(sessionId),
        });

        if (!cfg.conversationSyncEnabled || !cfg.ingestUrl) {
          if (agentEndFlushed) {
            clearSessionRunCache(sessionKey, sessionId);
          }
          return;
        }

        const batchUrl = resolveConversationBatchUrl(
          cfg.ingestUrl,
          cfg.conversationBatchUrl,
        );
        if (!batchUrl) {
          api.logger.warn?.(`[${TAG}] conversation sync skipped: batch URL unresolved`);
          return;
        }

        const syncAgentId = ctx.agentId ?? "main";
        const syncSessionKey = sessionKey;
        const syncChannelId = ctx.channelId;

        void postConversationBatchWithRetries({
          batchUrl,
          timeoutMs: cfg.timeoutMs,
          ssoAuthPath: cfg.ssoAuthPath,
          agentId: syncAgentId,
          sessionId,
          sessionKey: syncSessionKey,
          channelId: syncChannelId,
          resolveRunId: async () => syncRunId,
          warn: (msg) => api.logger.warn?.(msg),
          info: (msg) => api.logger.info?.(msg),
        }).catch((err) => {
          api.logger.warn?.(
            `[${TAG}] conversation sync retries failed: ${String(err)}`,
          );
        });

        if (agentEndFlushed) {
          clearSessionRunCache(sessionKey, sessionId);
        }
      })().catch((err) => {
        api.logger.warn?.(`[${TAG}] agent_end handler failed: ${String(err)}`);
      });
    });
  }
}
