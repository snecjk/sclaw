import { hostApiFetch } from '@/lib/host-api';
import {
  parseClaudeScheduledTaskRunSessionKey,
  parseClaudeScheduledTaskSessionKey,
  parseCronSessionKey,
  parsePiScheduledTaskSessionKey,
} from '@/stores/chat/cron-session-utils';
import { useCronStore } from '@/stores/cron';
import type { DataCenterArtifactProvenance } from '@/types/data-center';
import type { ScheduleTask } from '@/types/scheduled-task';

export function getScheduledTaskIdFromSessionKey(sessionKey: string): string | null {
  const cron = parseCronSessionKey(sessionKey);
  if (cron?.jobId) return cron.jobId;

  const claudeTask = parseClaudeScheduledTaskSessionKey(sessionKey);
  if (claudeTask?.taskId) return claudeTask.taskId;

  const claudeRun = parseClaudeScheduledTaskRunSessionKey(sessionKey);
  if (claudeRun?.taskId) return claudeRun.taskId;

  const piTask = parsePiScheduledTaskSessionKey(sessionKey);
  if (piTask?.taskId) return piTask.taskId;

  return null;
}

function getCachedScheduledTaskTitle(taskId: string): string | null {
  const task = useCronStore.getState().jobs.find((job) => job.id === taskId);
  return task?.name?.trim() || null;
}

export function enrichScheduledTaskArtifactProvenance(
  provenance: DataCenterArtifactProvenance,
): DataCenterArtifactProvenance {
  if (provenance.sourceType !== 'scheduled_task_artifact') return provenance;

  const sourceId = provenance.sourceId?.trim() || getScheduledTaskIdFromSessionKey(provenance.sessionId);
  if (!sourceId) return provenance;

  return {
    ...provenance,
    sourceId,
    sourceTitle: provenance.sourceTitle?.trim() || getCachedScheduledTaskTitle(sourceId) || undefined,
  };
}

export async function resolveScheduledTaskArtifactProvenance(
  provenance: DataCenterArtifactProvenance,
): Promise<DataCenterArtifactProvenance> {
  const enriched = enrichScheduledTaskArtifactProvenance(provenance);
  if (enriched.sourceType !== 'scheduled_task_artifact' || enriched.sourceTitle?.trim() || !enriched.sourceId) {
    return enriched;
  }

  try {
    const tasks = await hostApiFetch<ScheduleTask[]>('/api/scheduled-tasks');
    const task = tasks.find((item) => item.id === enriched.sourceId);
    const sourceTitle = task?.name?.trim();
    return sourceTitle ? { ...enriched, sourceTitle } : enriched;
  } catch {
    return enriched;
  }
}
