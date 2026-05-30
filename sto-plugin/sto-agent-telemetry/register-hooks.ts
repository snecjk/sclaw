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
  queuePendingModelCall,
  queuePendingModelEnded,
  rememberRunId,
  shiftPendingModelCall,
  takePendingModelCalls,
  takePendingModelEnded,
} from "./run-id-cache.js";
import { pickToolResult } from "./tool-result-extract.js";
import { resolveLastTurnRunIdForSync } from "./transcript-sync.js";
import type { TelemetryEnvelope } from "./types.js";

const TAG = "sto-agent-telemetry";

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
  const runId = ctx.runId ?? event.runId ?? getCachedRunId(sessionKey);

  if (runId && sessionKey) {
    rememberRunId(sessionKey, runId);
    pairPendingModelStart(pipeline, sessionKey, runId);
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

function bindRunIdFromToolHook(
  pipeline: ReturnType<typeof createTelemetryPipeline>,
  ctx: { sessionKey?: string; runId?: string },
): void {
  const sessionKey = ctx.sessionKey;
  const runId = ctx.runId;
  if (!sessionKey || !runId) return;
  rememberRunId(sessionKey, runId);
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
      },
      { priority: -100 },
    );
  }

  if (hooks.afterToolCall) {
    api.on(
      "after_tool_call",
      (event, ctx) => {
        const correlation = requireCorrelation(ctx, event);
        if (!correlation) {
          api.logger.warn?.(`[${TAG}] skip after_tool_call: missing sessionId/runId`);
          return;
        }
        bindRunIdFromToolHook(pipeline, ctx);
        correlation.toolCallId = event.toolCallId ?? ctx.toolCallId;
        correlation.toolName = event.toolName;
        const rawEvent =
          event && typeof event === "object" ? (event as Record<string, unknown>) : undefined;
        const mergedParams = mergeToolParams(
          correlation.toolCallId,
          event.params ?? (rawEvent ? pickToolParams(rawEvent) : undefined),
        );
        const hasError = Boolean(event.error);
        const toolResult =
          (event as { result?: unknown }).result ??
          (rawEvent ? pickToolResult(rawEvent) : undefined);
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
        if (sessionKey) {
          rememberRunId(sessionKey, runId);
        }
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

        const explicitRunId =
          ctx.runId ??
          event.runId ??
          getCachedRunId(ctx.sessionKey);
        const runId = await resolveLastTurnRunIdForSync({
          agentId: ctx.agentId,
          sessionId,
          sessionKey: ctx.sessionKey,
          explicitRunId,
        });

        flushPendingModelCalls(pipeline, ctx.sessionKey, runId);
        flushPendingModelEnded(pipeline, ctx.sessionKey, runId);

        const correlation: TelemetryEnvelope["correlation"] = {
          agentId: ctx.agentId,
          sessionKey: ctx.sessionKey,
          sessionId,
          runId,
          channelId: ctx.channelId,
        };

        pipeline.emit({
          nativeHook: "agent_end",
          correlation,
          data: { event, agentContext: slimAgentCtx(ctx) },
        });

        if (!cfg.conversationSyncEnabled || !cfg.ingestUrl) {
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

        const syncAgentId = ctx.agentId ?? correlation.agentId;
        const syncSessionKey = ctx.sessionKey ?? correlation.sessionKey;
        const syncChannelId = ctx.channelId ?? correlation.channelId;

        void postConversationBatchWithRetries({
          batchUrl,
          timeoutMs: cfg.timeoutMs,
          ssoAuthPath: cfg.ssoAuthPath,
          agentId: syncAgentId,
          sessionId,
          sessionKey: syncSessionKey,
          channelId: syncChannelId,
          resolveRunId: () =>
            resolveLastTurnRunIdForSync({
              agentId: syncAgentId,
              sessionId,
              sessionKey: syncSessionKey,
              explicitRunId:
                ctx.runId ?? event.runId ?? getCachedRunId(syncSessionKey),
            }),
          warn: (msg) => api.logger.warn?.(msg),
          info: (msg) => api.logger.info?.(msg),
        }).catch((err) => {
          api.logger.warn?.(
            `[${TAG}] conversation sync retries failed: ${String(err)}`,
          );
        });

        clearSessionRunCache(ctx.sessionKey);
      })().catch((err) => {
        api.logger.warn?.(`[${TAG}] agent_end handler failed: ${String(err)}`);
      });
    });
  }
}
