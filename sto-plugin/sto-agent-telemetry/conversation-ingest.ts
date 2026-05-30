import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { ConversationMessageDraft } from "./transcript-parse.js";
import {
  extractSyncableTurnsFromJsonl,
  isTranscriptReadyForSync,
} from "./transcript-parse.js";
import {
  buildConversationBatchPayload,
  readConversationTurnFromTranscript,
  readTranscriptContent,
} from "./transcript-sync.js";

type SsoAuthInfo = {
  userName?: string;
  stoToken?: string;
};

/** agent_end 后按该时间表重试读取 transcript（相对 agent_end 的毫秒偏移）。 */
export const CONVERSATION_SYNC_RETRY_SCHEDULE_MS = [0, 3000, 10000, 30000] as const;

function resolveTildePath(filePath: string): string {
  if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return resolve(homedir(), filePath.slice(2));
  }
  return resolve(filePath);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
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

export function resolveConversationBatchUrl(ingestUrl: string, explicit?: string): string | null {
  const trimmed = explicit?.trim();
  if (trimmed) {
    return trimmed;
  }
  const eventsUrl = ingestUrl.trim();
  if (!eventsUrl) {
    return null;
  }
  if (eventsUrl.includes("/agent-telemetry/events")) {
    return eventsUrl.replace(
      "/agent-telemetry/events",
      "/agent-conversation/messages/batch",
    );
  }
  const base = eventsUrl.replace(/\/$/, "");
  return `${base.replace(/\/agent-telemetry\/events$/, "")}/agent-conversation/messages/batch`;
}

export async function postConversationBatchMessages(params: {
  batchUrl: string;
  timeoutMs: number;
  ssoAuthPath: string;
  sessionId: string;
  runId: string;
  messages: ConversationMessageDraft[];
  warn: (msg: string) => void;
  info?: (msg: string) => void;
}): Promise<boolean> {
  if (params.messages.length === 0) {
    return false;
  }

  const body = buildConversationBatchPayload(params.messages);
  const auth = await readSsoAuth(params.ssoAuthPath);
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "X-Sto-Conversation-Batch-Id": body.batch_id,
  };
  if (auth.stoToken) {
    headers.stoToken = auth.stoToken;
  }
  if (auth.userName) {
    headers["X-Sto-User-Name"] = auth.userName;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const res = await fetch(params.batchUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      params.warn(
        `[sto-agent-telemetry] conversation batch HTTP ${res.status} ${res.statusText} url=${params.batchUrl} batch=${body.batch_id}`,
      );
      return false;
    }
    params.info?.(
      `[sto-agent-telemetry] conversation batch ok messages=${params.messages.length} session=${params.sessionId} run=${params.runId} batch=${body.batch_id}`,
    );
    return true;
  } catch (err) {
    params.warn(
      `[sto-agent-telemetry] conversation batch failed batch=${body.batch_id}: ${String(err)}`,
    );
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function postConversationBatch(params: {
  batchUrl: string;
  timeoutMs: number;
  ssoAuthPath: string;
  agentId?: string;
  sessionId: string;
  sessionKey?: string;
  runId: string;
  channelId?: string;
  warn: (msg: string) => void;
  info?: (msg: string) => void;
}): Promise<void> {
  const messages = await readConversationTurnFromTranscript({
    agentId: params.agentId,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    runId: params.runId,
    channelId: params.channelId,
  });
  if (messages.length === 0) {
    params.warn(
      `[sto-agent-telemetry] conversation sync skipped: no complete user/assistant in transcript session=${params.sessionId} sessionKey=${params.sessionKey ?? "-"} run=${params.runId}`,
    );
    return;
  }

  await postConversationBatchMessages({
    batchUrl: params.batchUrl,
    timeoutMs: params.timeoutMs,
    ssoAuthPath: params.ssoAuthPath,
    sessionId: params.sessionId,
    runId: params.runId,
    messages,
    warn: params.warn,
    info: params.info,
  });
}

/**
 * agent_end 后延迟重试**本地读取** transcript（0 / 3s / 10s / 30s）。
 * 仅当判定「已有完整问答且末尾无悬空提问」时 **POST 一次**并结束重试；
 * 若 30s 内始终不完整则不上报。
 */
export async function postConversationBatchWithRetries(params: {
  batchUrl: string;
  timeoutMs: number;
  ssoAuthPath: string;
  agentId?: string;
  sessionId: string;
  sessionKey?: string;
  channelId?: string;
  resolveRunId: () => Promise<string>;
  scheduleMs?: readonly number[];
  warn: (msg: string) => void;
  info?: (msg: string) => void;
}): Promise<void> {
  const schedule = params.scheduleMs ?? CONVERSATION_SYNC_RETRY_SCHEDULE_MS;
  let elapsed = 0;
  let posted = false;

  for (let attempt = 0; attempt < schedule.length; attempt += 1) {
    const targetMs = schedule[attempt] ?? 0;
    const waitMs = targetMs - elapsed;
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    elapsed = targetMs;

    const runId = (await params.resolveRunId()).trim();
    if (!runId) {
      params.warn(
        `[sto-agent-telemetry] conversation sync retry ${attempt}: missing runId session=${params.sessionId}`,
      );
      continue;
    }

    const content = await readTranscriptContent({
      agentId: params.agentId,
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
    });
    if (!content) {
      params.info?.(
        `[sto-agent-telemetry] conversation sync retry ${attempt}: transcript not found session=${params.sessionId}`,
      );
      continue;
    }

    if (!isTranscriptReadyForSync(content)) {
      params.info?.(
        `[sto-agent-telemetry] conversation sync retry ${attempt}: transcript not ready session=${params.sessionId} delayMs=${targetMs}`,
      );
      continue;
    }

    const messages = extractSyncableTurnsFromJsonl(content, {
      sessionId: params.sessionId,
      runId,
      agentId: params.agentId,
      channelId: params.channelId,
    });
    if (messages.length === 0) {
      continue;
    }

    const ok = await postConversationBatchMessages({
      batchUrl: params.batchUrl,
      timeoutMs: params.timeoutMs,
      ssoAuthPath: params.ssoAuthPath,
      sessionId: params.sessionId,
      runId,
      messages,
      warn: params.warn,
      info: params.info,
    });
    if (ok) {
      posted = true;
      params.info?.(
        `[sto-agent-telemetry] conversation sync posted once after retry ${attempt} session=${params.sessionId}`,
      );
      return;
    }
  }

  if (!posted) {
    params.warn(
      `[sto-agent-telemetry] conversation sync gave up: transcript never ready session=${params.sessionId} sessionKey=${params.sessionKey ?? "-"}`,
    );
  }
}
