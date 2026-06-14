import type { OpenClawPluginApi } from "./api.js";
import { buildTelemetryEnvelope } from "./envelope.js";
import { sanitizeForExport } from "./sanitize.js";
import { buildExporters } from "./exporters/index.js";
import type { TelemetryPluginConfig, TelemetryEnvelope } from "./types.js";

export type TelemetryPipeline = {
  emit: (input: {
    nativeHook: string;
    correlation: TelemetryEnvelope["correlation"];
    data: unknown;
    outcome?: TelemetryEnvelope["outcome"];
    actor?: TelemetryEnvelope["actor"];
  }) => void;
};

export function createTelemetryPipeline(
  api: OpenClawPluginApi,
  cfg: TelemetryPluginConfig,
): TelemetryPipeline {
  const exporters = buildExporters({
    cfg,
    warn: (msg) => {
      api.logger.warn?.(msg);
    },
  });
  const sanitization = cfg.sanitization;

  const exportOne = async (envelope: TelemetryEnvelope) => {
    await Promise.allSettled(exporters.map((ex) => ex.export(envelope)));
  };

  return {
    emit({ nativeHook, correlation, data, outcome, actor }) {
      const sanitizedData = sanitization.enabled
        ? sanitizeForExport(data, sanitization)
        : data;
      const envelope = buildTelemetryEnvelope({
        nativeHook,
        correlation,
        data: sanitizedData,
        outcome,
        actor,
      });
      void exportOne(envelope).catch((err) => {
        api.logger.warn?.(`[sto-agent-telemetry] pipeline: ${String(err)}`);
      });
    },
  };
}
