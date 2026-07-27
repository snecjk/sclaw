import { useEffect, useState } from 'react';
import { hostApiFetch } from '@/lib/host-api';
import type { ScheduledTaskNameMaps } from '@/lib/scheduled-task-group-name';

const EMPTY_MAPS: ScheduledTaskNameMaps = {
  cron: new Map(),
  sto: new Map(),
  claude: new Map(),
};

async function loadScheduledTaskNameMaps(): Promise<ScheduledTaskNameMaps> {
  const cron = new Map<string, string>();
  const sto = new Map<number, string>();
  const claude = new Map<string, string>();

  try {
    const jobs = await hostApiFetch<Array<{ id: string; name: string }>>('/api/cron/jobs');
    for (const job of jobs) {
      if (job.id && job.name?.trim()) cron.set(job.id, job.name.trim());
    }
  } catch {
    // Gateway may be unavailable; local fallback below.
  }

  try {
    const fallbackJobs = await hostApiFetch<Array<{ id: string; name: string }>>('/api/cron/local-job-names');
    for (const job of fallbackJobs) {
      if (job.id && job.name?.trim() && !cron.has(job.id)) {
        cron.set(job.id, job.name.trim());
      }
    }
  } catch {
    // Best-effort fallback.
  }

  try {
    const tasks = await hostApiFetch<Array<{ id: string; name: string }>>('/api/claude-scheduled-tasks');
    for (const task of tasks) {
      if (task.id && task.name?.trim()) claude.set(task.id, task.name.trim());
    }
  } catch {
    // Ignore Claude task list failures.
  }

  return { cron, sto, claude };
}

/** Cached task-name maps for sidebar task-list group titles. */
export function useScheduledTaskNameMaps(enabled: boolean, refreshKey = 0): ScheduledTaskNameMaps {
  const [maps, setMaps] = useState<ScheduledTaskNameMaps>(EMPTY_MAPS);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadScheduledTaskNameMaps().then((next) => {
      if (!cancelled) setMaps(next);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, refreshKey]);

  return maps;
}

export { loadScheduledTaskNameMaps };
