import { useEffect, useState } from 'react';
import { hostApiFetch } from '@/lib/host-api';
import type { ScheduledTaskNameMaps } from '@/lib/scheduled-task-group-name';

const EMPTY_MAPS: ScheduledTaskNameMaps = {
  cron: new Map(),
  sto: new Map(),
  claude: new Map(),
  pi: new Map(),
};

async function loadScheduledTaskNameMaps(): Promise<ScheduledTaskNameMaps> {
  const cron = new Map<string, string>();
  const sto = new Map<number, string>();
  const claude = new Map<string, string>();
  const pi = new Map<string, string>();

  // 统一源 /api/scheduled-tasks 自带 engineType，按引擎分别建立名称映射。
  try {
    const tasks = await hostApiFetch<
      Array<{ id: string; name: string; engineType: 'openclaw' | 'claude' | 'pi' }>
    >('/api/scheduled-tasks');
    for (const task of tasks) {
      if (!task.id || !task.name?.trim()) continue;
      const trimmed = task.name.trim();
      if (task.engineType === 'claude') claude.set(task.id, trimmed);
      else if (task.engineType === 'pi') pi.set(task.id, trimmed);
      else cron.set(task.id, trimmed);
    }
  } catch {
    // Best-effort; maps remain empty.
  }

  return { cron, sto, claude, pi };
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
