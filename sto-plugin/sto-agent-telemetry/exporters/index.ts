import type { TelemetryPluginConfig } from "../types.js";
import type { TelemetryExporter } from "./types.js";
import { createHmIngestExporter } from "./hm-ingest-exporter.js";

export function buildExporters(params: {
  cfg: TelemetryPluginConfig;
  warn: (msg: string) => void;
}): TelemetryExporter[] {
  const { cfg, warn } = params;
  if (!cfg.enabled || !cfg.ingestUrl) {
    return [];
  }
  return [
    createHmIngestExporter({
      ingestUrl: cfg.ingestUrl,
      timeoutMs: cfg.timeoutMs,
      ssoAuthPath: cfg.ssoAuthPath,
      warn,
    }),
  ];
}
