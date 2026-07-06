/**
 * Append workflow execution lifecycle records to Claude SDK session JSONL
 * transcripts under ~/.stoclaw/.claude/projects/ (per-session JSONL files).
 *
 * Mirrors OpenClaw workflow-session-writer so workflow UI survives reinstall
 * when localStorage is cleared but Claude transcripts remain on disk.
 */
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildWorkflowExecutionSessionRecord,
  type WorkflowExecutionSessionRecord,
} from '../../shared/workflow-session-record';
import { getEngineSessionRegistryEntry, upsertEngineSessionRegistryEntry } from '../engines/session-registry';
import { getClaudeConfigDir } from '../utils/paths';
import { logger } from '../utils/logger';

export type ClaudeAppendWorkflowSessionRecordInput = WorkflowExecutionSessionRecord['data'];

/** Claude SDK SessionStoreEntry shape for a synthetic workflow tool_result user turn. */
export interface ClaudeWorkflowSessionEntry {
  type: 'user';
  uuid: string;
  session_id: string;
  timestamp: string;
  message: {
    role: 'user';
    content: Array<{
      type: 'tool_result';
      tool_use_id: string;
      name: string;
      content: Array<{ type: 'text'; text: string }>;
    }>;
  };
  parent_tool_use_id: null;
  isSynthetic: true;
}

export function buildClaudeWorkflowSessionEntry(
  sessionId: string,
  envelope: WorkflowExecutionSessionRecord,
  toolCallId: string,
  nowMs: number,
): ClaudeWorkflowSessionEntry {
  return {
    type: 'user',
    uuid: randomUUID(),
    session_id: sessionId,
    timestamp: new Date(nowMs).toISOString(),
    message: {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: toolCallId,
        name: 'sto_workflow_session',
        content: [{ type: 'text', text: JSON.stringify(envelope) }],
      }],
    },
    parent_tool_use_id: null,
    isSynthetic: true,
  };
}

async function findClaudeSessionJsonl(sessionId: string): Promise<string | null> {
  const projectsRoot = join(getClaudeConfigDir(), 'projects');
  const targetName = `${sessionId}.jsonl`;

  async function walk(dir: string, depth: number): Promise<string | null> {
    if (depth > 8) return null;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return null;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isFile() && entry.name === targetName) {
        return fullPath;
      }
      if (entry.isDirectory()) {
        const nested = await walk(fullPath, depth + 1);
        if (nested) return nested;
      }
    }
    return null;
  }

  return walk(projectsRoot, 0);
}

/** Encode cwd the same way Claude Code derives project keys (path segments joined by `-`). */
export function encodeClaudeProjectKey(cwd: string): string {
  const normalized = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) return '-';
  return `-${segments.join('-')}`;
}

async function resolveClaudeSessionJsonl(sessionId: string, cwd: string): Promise<string | null> {
  const existing = await findClaudeSessionJsonl(sessionId);
  if (existing) return existing;

  const projectKey = encodeClaudeProjectKey(cwd);
  const candidate = join(getClaudeConfigDir(), 'projects', projectKey, `${sessionId}.jsonl`);
  try {
    await stat(candidate);
    return candidate;
  } catch {
    return null;
  }
}

export async function appendClaudeWorkflowSessionRecord(
  input: ClaudeAppendWorkflowSessionRecordInput,
): Promise<void> {
  const entry = await getEngineSessionRegistryEntry(input.sessionKey);
  if (!entry?.sessionId || !entry.cwd) {
    logger.warn(
      `[ClaudeWorkflowSessionWriter] Missing Claude session registry entry for key=${input.sessionKey}`,
    );
    return;
  }

  const sessionFile = await resolveClaudeSessionJsonl(entry.sessionId, entry.cwd);
  if (!sessionFile) {
    logger.warn(
      `[ClaudeWorkflowSessionWriter] No Claude JSONL for sessionId=${entry.sessionId} cwd=${entry.cwd}`,
    );
    return;
  }

  const envelope = buildWorkflowExecutionSessionRecord(input);
  const toolCallId = `sto_wf_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = Date.now();
  const line = buildClaudeWorkflowSessionEntry(entry.sessionId, envelope, toolCallId, now);

  await mkdir(join(sessionFile, '..'), { recursive: true });
  await appendFile(sessionFile, `${JSON.stringify(line)}\n`, 'utf8');

  await upsertEngineSessionRegistryEntry({
    ...entry,
    engineType: 'claude',
    updatedAt: now,
  });

  logger.info(
    `[ClaudeWorkflowSessionWriter] Appended ${input.phase} runId=${input.runId} to ${sessionFile}`,
  );
}
