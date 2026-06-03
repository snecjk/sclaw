import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  countConversationTurns,
  extractSyncableTurnsFromJsonl,
  newConversationBatchId,
  type ConversationMessageDraft,
} from "./transcript-parse.js";

function resolveOpenClawAgentsDir(): string {
  return join(homedir(), ".stoclaw", "openclaw", "agents");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveTranscriptPathFromSessionsStore(params: {
  agentId: string;
  sessionId: string;
  sessionKey?: string;
}): Promise<string | null> {
  const agentId = params.agentId.trim() || "main";
  const sessionsJsonPath = join(
    resolveOpenClawAgentsDir(),
    agentId,
    "sessions",
    "sessions.json",
  );
  let raw: string;
  try {
    raw = await readFile(sessionsJsonPath, "utf-8");
  } catch {
    return null;
  }

  let store: Record<string, unknown>;
  try {
    store = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  const sessionKey = params.sessionKey?.trim();
  const sessionId = params.sessionId.trim();
  const candidates: unknown[] = [];
  if (sessionKey && store[sessionKey] != null) {
    candidates.push(store[sessionKey]);
  }
  if (store[sessionId] != null) {
    candidates.push(store[sessionId]);
  }

  const sessions = store.sessions;
  if (Array.isArray(sessions)) {
    for (const item of sessions) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      const key = String(entry.key ?? entry.sessionKey ?? "");
      const id = String(entry.id ?? entry.sessionId ?? "");
      if ((sessionKey && key === sessionKey) || (sessionId && id === sessionId)) {
        candidates.push(entry);
      }
    }
  }

  for (const candidate of candidates) {
    const path = extractSessionFilePath(candidate, agentId);
    if (path && (await fileExists(path))) {
      return path;
    }
  }
  return null;
}

function extractSessionFilePath(entry: unknown, agentId: string): string | null {
  if (typeof entry === "string") {
    const trimmed = entry.trim();
    if (!trimmed) return null;
    if (trimmed.endsWith(".jsonl")) {
      return trimmed.startsWith("/") || /^[A-Za-z]:\\/.test(trimmed)
        ? trimmed
        : join(resolveOpenClawAgentsDir(), agentId, "sessions", trimmed);
    }
    return join(resolveOpenClawAgentsDir(), agentId, "sessions", `${trimmed}.jsonl`);
  }
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const record = entry as Record<string, unknown>;
  const absFile = String(record.sessionFile ?? record.file ?? record.path ?? "").trim();
  if (absFile) {
    return absFile;
  }
  const uuid = String(record.sessionId ?? record.id ?? "").trim();
  if (!uuid) {
    return null;
  }
  const fileName = uuid.endsWith(".jsonl") ? uuid : `${uuid}.jsonl`;
  return join(resolveOpenClawAgentsDir(), agentId, "sessions", fileName);
}

async function resolveTranscriptPath(params: {
  agentId: string;
  sessionId: string;
  sessionKey?: string;
}): Promise<string | null> {
  const agentId = params.agentId.trim() || "main";
  const sessionId = params.sessionId.trim();
  if (!sessionId) {
    return null;
  }

  const directPath = join(
    resolveOpenClawAgentsDir(),
    agentId,
    "sessions",
    sessionId.endsWith(".jsonl") ? sessionId : `${sessionId}.jsonl`,
  );
  if (await fileExists(directPath)) {
    return directPath;
  }

  return resolveTranscriptPathFromSessionsStore(params);
}

/**
 * OpenClaw 0322 的 agent_end hook 不传 runId；用 transcript 轮次生成稳定占位 runId。
 */
export async function resolveLastTurnRunIdForSync(params: {
  agentId?: string;
  sessionId: string;
  sessionKey?: string;
  explicitRunId?: string;
}): Promise<string> {
  const sessionId = params.sessionId.trim();
  const explicit = params.explicitRunId?.trim();
  if (explicit) {
    return explicit;
  }

  const transcriptPath = await resolveTranscriptPath({
    agentId: params.agentId?.trim() || "main",
    sessionId,
    sessionKey: params.sessionKey,
  });
  if (!transcriptPath) {
    return `${sessionId}:agent_end`;
  }

  try {
    const content = await readFile(transcriptPath, "utf-8");
    const turnCount = countConversationTurns(content);
    if (turnCount > 0) {
      return `${sessionId}:turn:${turnCount}`;
    }
  } catch {
    // fall through
  }
  return `${sessionId}:agent_end`;
}

export async function readTranscriptContent(params: {
  agentId?: string;
  sessionId: string;
  sessionKey?: string;
}): Promise<string | null> {
  const agentId = params.agentId?.trim() || "main";
  const sessionId = params.sessionId.trim();
  if (!sessionId) {
    return null;
  }

  const transcriptPath = await resolveTranscriptPath({
    agentId,
    sessionId,
    sessionKey: params.sessionKey,
  });
  if (!transcriptPath) {
    return null;
  }

  try {
    return await readFile(transcriptPath, "utf-8");
  } catch {
    return null;
  }
}

export async function readConversationTurnFromTranscript(params: {
  agentId?: string;
  sessionId: string;
  sessionKey?: string;
  runId: string;
  channelId?: string;
}): Promise<ConversationMessageDraft[]> {
  const agentId = params.agentId?.trim() || "main";
  const sessionId = params.sessionId.trim();
  const runId = params.runId.trim();
  if (!sessionId || !runId) {
    return [];
  }

  const content = await readTranscriptContent({
    agentId,
    sessionId,
    sessionKey: params.sessionKey,
  });
  if (!content) {
    return [];
  }

  return extractSyncableTurnsFromJsonl(content, {
    sessionId,
    runId,
    agentId,
    channelId: params.channelId,
  });
}

export function buildConversationBatchPayload(messages: ConversationMessageDraft[]) {
  return {
    schema: "sto.agent.conversation/v1",
    batch_id: newConversationBatchId(),
    messages,
  };
}
