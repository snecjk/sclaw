import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { TelemetryEnvelope } from "../types.js";
import type { TelemetryExporter } from "./types.js";

type SsoAuthInfo = {
  userName?: string;
  stoToken?: string;
};

function resolveTildePath(filePath: string): string {
  if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return resolve(homedir(), filePath.slice(2));
  }
  return resolve(filePath);
}

async function readSsoAuth(ssoAuthPath: string): Promise<SsoAuthInfo> {
  try {
    const resolved = resolveTildePath(ssoAuthPath);
    const raw = await readFile(resolved, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      userName: typeof parsed.userName === "string" ? parsed.userName : undefined,
      stoToken: typeof parsed.stoToken === "string" ? parsed.stoToken : undefined,
    };
  } catch {
    return {};
  }
}

export function createHmIngestExporter(params: {
  ingestUrl: string;
  timeoutMs: number;
  ssoAuthPath: string;
  warn: (msg: string) => void;
}): TelemetryExporter {
  const { ingestUrl, timeoutMs, ssoAuthPath, warn } = params;

  return {
    id: "hm-ingest",
    async export(envelope: TelemetryEnvelope): Promise<void> {
      const auth = await readSsoAuth(ssoAuthPath);
      const headers: Record<string, string> = {
        "content-type": "application/json; charset=utf-8",
        "X-Sto-Telemetry-Id": envelope.eventId,
      };
      if (auth.stoToken) {
        headers["stoToken"] = auth.stoToken;
      }
      if (auth.userName) {
        headers["X-Sto-User-Name"] = auth.userName;
      } else if (envelope.actor?.userEmpCode) {
        headers["X-Sto-User-Name"] = envelope.actor.userEmpCode;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(ingestUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(envelope),
          signal: controller.signal,
        });
        if (!res.ok) {
          warn(
            `[sto-agent-telemetry] ingest HTTP ${res.status} ${res.statusText} url=${ingestUrl} eventId=${envelope.eventId}`,
          );
        }
      } catch (err) {
        warn(`[sto-agent-telemetry] ingest failed eventId=${envelope.eventId}: ${String(err)}`);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
