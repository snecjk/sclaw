/**
 * useAppDevVersionRestore — 「恢复版本」确认流。
 *
 * 请求放在 workbench store 里，直到 confirm / cancel 才清空。
 * 不能在 effect 里立刻置 null：React Strict Mode 重挂载会丢掉本地 state，
 * 导致点了「恢复此版本」却没有任何反馈。
 */
import { useCallback, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { restoreAppCheckpoint } from '@/lib/app-dev-api';
import { hostApiFetch } from '@/lib/host-api';
import { useAppDevWorkbenchStore } from '@/stores/app-dev-workbench';
import { useAppDevVersionsStore } from '@/stores/app-dev-versions';

export interface AppDevVersionRestoreTarget {
  hash: string;
  /** 确认框里展示的标签：checkpoint subject，缺失时退化为短 hash。 */
  label: string;
}

function logVersionRestore(message: string, data?: unknown): void {
  console.info(message, data);
  void hostApiFetch('/api/logs/client', {
    method: 'POST',
    body: JSON.stringify({ level: 'info', message, data }),
  }).catch(() => undefined);
}

export function useAppDevVersionRestore(input: {
  workspaceId: string;
  onRestored?: () => void;
}): {
  target: AppDevVersionRestoreTarget | null;
  confirm: () => Promise<void>;
  cancel: () => void;
} {
  const { workspaceId, onRestored } = input;
  const request = useAppDevWorkbenchStore((s) => s.versionRestoreRequest);
  const versions = useAppDevVersionsStore(
    (s) => s.versionsByWorkspace[workspaceId] ?? null,
  );
  const onRestoredRef = useRef(onRestored);
  onRestoredRef.current = onRestored;

  const target = useMemo<AppDevVersionRestoreTarget | null>(() => {
    const hash = request?.hash?.trim();
    if (!hash) {
      if (request != null) {
        logVersionRestore('[app-dev][version-restore] hook target=null (empty hash)', { request });
      }
      return null;
    }
    const explicitLabel = request?.label?.trim();
    const resolved = explicitLabel
      ? { hash, label: explicitLabel }
      : {
          hash,
          label: (
            versions
              ? Object.values(versions).find((item) => item.hash === hash)
              : undefined
          )?.subject?.trim() || hash.slice(0, 7),
        };
    logVersionRestore('[app-dev][version-restore] hook target → dialog should open', {
      workspaceId,
      ...resolved,
    });
    return resolved;
  }, [request, versions, workspaceId]);

  const cancel = useCallback(() => {
    logVersionRestore('[app-dev][version-restore] cancel');
    useAppDevWorkbenchStore.getState().setVersionRestoreRequest(null);
  }, []);

  const confirm = useCallback(async () => {
    if (!target) return;
    logVersionRestore('[app-dev][version-restore] confirm start', {
      workspaceId,
      hash: target.hash,
    });
    const result = await restoreAppCheckpoint(workspaceId, target.hash).catch((err: unknown) => ({
      restored: false as const,
      error: err instanceof Error ? err.message : '暂时无法恢复',
    }));
    logVersionRestore('[app-dev][version-restore] confirm result', result);
    if (result?.restored) {
      toast.success('已恢复到所选本地版本（仅本机，未回滚云端）');
      onRestoredRef.current?.();
    } else {
      toast.error(result?.error?.trim() || '暂时无法恢复本地版本');
    }
    useAppDevWorkbenchStore.getState().setVersionRestoreRequest(null);
  }, [target, workspaceId]);

  return { target, confirm, cancel };
}
