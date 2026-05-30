import type { SanitizationConfig, TelemetryHooksConfig, TelemetryPluginConfig } from "./types.js";

const DEFAULT_HOOKS: TelemetryHooksConfig = {
  beforeToolCall: true,
  afterToolCall: true,
  modelCallStarted: true,
  modelCallEnded: true,
  agentEnd: true,
};

const DEFAULT_SANITIZATION: SanitizationConfig = {
  enabled: false,
  maxDepth: 32,
  maxStringLength: 512_000,
  maxArrayLength: 2000,
  redactKeys: [
    "password",
    "token",
    "authorization",
    "apiKey",
    "api_key",
    "secret",
    "cookie",
    "set-cookie",
    "stoToken",
  ],
};

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStr(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNum(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function mergeHooks(raw: unknown): TelemetryHooksConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_HOOKS };
  }
  const h = raw as Record<string, unknown>;
  return {
    beforeToolCall: asBool(h.beforeToolCall, DEFAULT_HOOKS.beforeToolCall),
    afterToolCall: asBool(h.afterToolCall, DEFAULT_HOOKS.afterToolCall),
    modelCallStarted: asBool(h.modelCallStarted, DEFAULT_HOOKS.modelCallStarted),
    modelCallEnded: asBool(h.modelCallEnded, DEFAULT_HOOKS.modelCallEnded),
    agentEnd: asBool(h.agentEnd, DEFAULT_HOOKS.agentEnd),
  };
}

function mergeSanitization(raw: unknown): SanitizationConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_SANITIZATION, redactKeys: [...DEFAULT_SANITIZATION.redactKeys] };
  }
  const s = raw as Record<string, unknown>;
  const redactKeys = Array.isArray(s.redactKeys)
    ? s.redactKeys.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [...DEFAULT_SANITIZATION.redactKeys];
  return {
    enabled: asBool(s.enabled, DEFAULT_SANITIZATION.enabled),
    maxDepth: asNum(s.maxDepth, DEFAULT_SANITIZATION.maxDepth, 1, 64),
    maxStringLength: asNum(s.maxStringLength, DEFAULT_SANITIZATION.maxStringLength, 64, 2_000_000),
    maxArrayLength: asNum(s.maxArrayLength, DEFAULT_SANITIZATION.maxArrayLength, 1, 20_000),
    redactKeys: redactKeys.length > 0 ? redactKeys : [...DEFAULT_SANITIZATION.redactKeys],
  };
}

export function resolveTelemetryConfig(raw: unknown): TelemetryPluginConfig {
  const root =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    enabled: asBool(root.enabled, true),
    ingestUrl: asStr(root.ingestUrl),
    conversationBatchUrl: asStr(root.conversationBatchUrl),
    conversationSyncEnabled: asBool(root.conversationSyncEnabled, true),
    timeoutMs: asNum(root.timeoutMs, 5000, 500, 30_000),
    ssoAuthPath: asStr(root.ssoAuthPath) ?? "~/.stoclaw/openclaw/sso-auth.json",
    hooks: mergeHooks(root.hooks),
    sanitization: mergeSanitization(root.sanitization),
  };
}

export function validateTelemetryConfig(cfg: TelemetryPluginConfig): string | null {
  if (!cfg.enabled) {
    return null;
  }
  if (!cfg.ingestUrl?.trim()) {
    return "[sto-agent-telemetry] ingestUrl is required when plugin is enabled.";
  }
  return null;
}
