/**
 * Workflow Session Writer
 *
 * Appends workflow execution lifecycle records to session transcripts:
 * - OpenClaw: agents/{id}/sessions/*.jsonl
 * - Claude: ~/.stoclaw/.claude/projects/<project-dir>/{sessionId}.jsonl
 *
 * Completed workflow UI can be restored after app reinstall when session files remain.
 */

import { randomUUID } from 'node:crypto';
import { readFile, appendFile, access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getEngineSessionRegistryEntry } from '../engines/session-registry';
import { getOpenClawConfigDir } from '../utils/paths';
import { logger } from '../utils/logger';
import { appendClaudeWorkflowSessionRecord } from './claude-workflow-session-writer';
import {
  buildWorkflowExecutionSessionRecord,
  type WorkflowExecutionSessionRecord,
} from '../../shared/workflow-session-record';

interface SessionStoreEntry {
  sessionId: string;
  sessionFile: string;
  [key: string]: unknown;
}

interface SessionStore {
  sessions?: Array<{ key?: string; sessionKey?: string; sessionFile?: string; sessionId?: string; [key: string]: unknown }>;
  [sessionKey: string]: unknown;
}

function getSessionsJsonPath(agentId: string): string {
  return join(getOpenClawConfigDir(), 'agents', agentId, 'sessions', 'sessions.json');
}

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return (agentId || 'main').trim().toLowerCase();
}

async function readSessionStore(agentId: string): Promise<SessionStore> {
  const storePath = getSessionsJsonPath(agentId);
  try {
    const raw = await readFile(storePath, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw) as SessionStore;
  } catch {
    return {};
  }
}

function findSessionEntry(store: SessionStore, sessionKey: string): SessionStoreEntry | undefined {
  const direct = store[sessionKey];
  if (direct && typeof direct === 'object' && direct !== null) {
    const entry = direct as Record<string, unknown>;
    if (typeof entry.sessionFile === 'string' && typeof entry.sessionId === 'string') {
      return { sessionId: entry.sessionId, sessionFile: entry.sessionFile };
    }
  }

  if (!Array.isArray(store.sessions)) return undefined;
  const arrayEntry = store.sessions.find(
    (s) => s.key === sessionKey || s.sessionKey === sessionKey,
  );
  if (
    arrayEntry
    && typeof arrayEntry.sessionFile === 'string'
    && typeof arrayEntry.sessionId === 'string'
  ) {
    return { sessionId: arrayEntry.sessionId, sessionFile: arrayEntry.sessionFile };
  }

  return undefined;
}

async function resolveSessionFile(agentId: string, sessionKey: string): Promise<string | null> {
  const store = await readSessionStore(agentId);
  const entry = findSessionEntry(store, sessionKey);
  if (!entry?.sessionFile) {
    logger.warn(`[WorkflowSessionWriter] No session file for key=${sessionKey}`);
    return null;
  }

  try {
    await access(entry.sessionFile);
    return entry.sessionFile;
  } catch {
    logger.warn(`[WorkflowSessionWriter] Session file missing: ${entry.sessionFile}`);
    return null;
  }
}

export type AppendWorkflowSessionRecordInput = WorkflowExecutionSessionRecord['data'];

export { buildWorkflowExecutionSessionRecord };

/**
 * Append a workflow execution record as a toolResult line (sto envelope format).
 */
export async function appendWorkflowSessionRecord(
  input: AppendWorkflowSessionRecordInput,
): Promise<void> {
  const registryEntry = await getEngineSessionRegistryEntry(input.sessionKey);
  if (registryEntry?.engineType === 'claude') {
    await appendClaudeWorkflowSessionRecord(input);
    return;
  }

  const agentId = getAgentIdFromSessionKey(input.sessionKey);
  const sessionFile = await resolveSessionFile(agentId, input.sessionKey);
  if (!sessionFile) return;

  const envelope = buildWorkflowExecutionSessionRecord(input);
  const toolCallId = `sto_wf_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = Date.now();
  const line = {
    type: 'message',
    id: randomUUID().replace(/-/g, '').slice(0, 8),
    parentId: null,
    timestamp: new Date(now).toISOString(),
    message: {
      role: 'toolResult',
      toolCallId,
      toolName: 'sto_workflow_session',
      content: [{ type: 'text', text: JSON.stringify(envelope) }],
      details: envelope,
      isError: false,
      timestamp: now,
    },
  };

  await mkdir(join(getOpenClawConfigDir(), 'agents', agentId, 'sessions'), { recursive: true });
  await appendFile(sessionFile, `${JSON.stringify(line)}\n`, 'utf8');
  logger.info(
    `[WorkflowSessionWriter] Appended ${input.phase} runId=${input.runId} to ${sessionFile}`,
  );
}
