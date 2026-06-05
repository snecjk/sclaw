/**
 * Cloud Result Cache Service
 *
 * Persists cloud task execution results to local filesystem
 * using the same format as local cron run logs (jsonl).
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getOpenClawConfigDir } from '../utils/paths';
import { logger } from '../utils/logger';
import type { CloudTaskResult } from '../shared/cloud-cron';
import { appendCloudResultsToSessions } from './cloud-session-writer';

/**
 * Write cloud task results to local cache.
 * Format matches existing cron/runs/{jobId}.jsonl structure.
 */
export async function writeCloudResultsToCache(results: CloudTaskResult[]): Promise<void> {
  if (!results || results.length === 0) return;

  const baseDir = join(getOpenClawConfigDir(), 'cron', 'runs');
  await mkdir(baseDir, { recursive: true });

  // Group results by taskId
  const byTask = new Map<string, CloudTaskResult[]>();
  for (const result of results) {
    const list = byTask.get(result.taskId) || [];
    list.push(result);
    byTask.set(result.taskId, list);
  }

  // Append each group to its respective jsonl file
  for (const [taskId, taskResults] of byTask) {
    const filePath = join(baseDir, `${taskId}.jsonl`);
    const lines = taskResults
      .map((r) => JSON.stringify({
        jobId: r.taskId,
        runAtMs: new Date(r.startedAt).getTime(),
        ts: new Date(r.completedAt).getTime(),
        status: r.status === 'success' ? 'ok' : 'error',
        error: r.error?.message,
        summary: r.output?.message,
        durationMs: r.duration,
        model: r.model,
        provider: undefined,
        resultId: r.id,
      }))
      .join('\n') + '\n';

    await appendFile(filePath, lines, 'utf8');
    logger.info(`[CloudResultCache] Wrote ${taskResults.length} results to ${filePath}`);
  }

  // Also append results to corresponding chat sessions
  try {
    await appendCloudResultsToSessions(results);
  } catch (err) {
    logger.error(`[CloudResultCache] Failed to append results to sessions: ${String(err)}`);
  }
}

/**
 * Track processed result IDs to avoid duplicates.
 * Uses a simple in-memory Set (resets on app restart).
 * For persistent dedup, we could scan the jsonl files.
 */
const processedResultIds = new Set<string>();

/**
 * Filter out already-processed results.
 */
export function filterNewResults(results: CloudTaskResult[]): CloudTaskResult[] {
  const newResults = results.filter((r) => !processedResultIds.has(r.id));
  for (const r of newResults) {
    processedResultIds.add(r.id);
  }
  return newResults;
}
