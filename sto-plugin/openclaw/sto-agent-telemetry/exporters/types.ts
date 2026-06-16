import type { TelemetryEnvelope } from "../types.js";

export type TelemetryExporter = {
  id: string;
  export: (envelope: TelemetryEnvelope) => Promise<void>;
};
