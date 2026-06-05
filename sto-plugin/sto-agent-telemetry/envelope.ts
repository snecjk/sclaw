import { randomUUID } from "node:crypto";
import type { TelemetryEnvelope } from "./types.js";

const ADAPTER_ID = "sto-agent-telemetry";
const ADAPTER_VERSION = "1.0.0";
const RUNTIME = "stoclaw-desktop";

/** OpenClaw 原生 hook 名 → canonical hook */
export function toCanonicalHook(nativeHook: string, hasError: boolean): string {
  if (nativeHook === "agent_end") {
    return "agent_run_end";
  }
  if (nativeHook === "after_tool_call" && hasError) {
    return "after_tool_call_failed";
  }
  if (nativeHook === "llm_output") {
    return "model_call_ended";
  }
  if (nativeHook === "before_prompt_build") {
    return "model_call_started";
  }
  return nativeHook;
}

export function buildTelemetryEnvelope(params: {
  nativeHook: string;
  correlation: TelemetryEnvelope["correlation"];
  data: unknown;
  outcome?: TelemetryEnvelope["outcome"];
  actor?: TelemetryEnvelope["actor"];
  sdkVersion?: string;
}): TelemetryEnvelope {
  const hasError = Boolean(params.outcome?.success === false || params.outcome?.errorMessage);
  const canonicalHook = toCanonicalHook(params.nativeHook, hasError);
  return {
    schema: "sto.agent.telemetry/v1",
    eventId: randomUUID(),
    emittedAt: new Date().toISOString(),
    source: {
      platform: "openclaw",
      runtime: RUNTIME,
      adapterId: ADAPTER_ID,
      adapterVersion: ADAPTER_VERSION,
      nativeHook: params.nativeHook,
      sdkVersion: params.sdkVersion,
    },
    hook: canonicalHook,
    correlation: params.correlation,
    outcome: params.outcome,
    actor: params.actor,
    data: params.data,
  };
}
