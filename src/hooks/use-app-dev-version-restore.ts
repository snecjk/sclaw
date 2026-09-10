/**
 * useAppDevVersionRestore — 消息级「恢复版本」请求消费 hook（P1 交互改造 T04）。
 *
 * 请求-消费模式：汇总卡按钮只 setVersionRestoreRequest({hash})，
 * 本 hook 在 AppPlazaDevAppPane 消费（置 null）并弹出二次确认；
 * confirm 走 restoreAppCheckpoint(workspaceId, hash)（服务层自动建 sclaw-backup-* 分支），
 * 成功后 onRestored 触发代码/预览刷新。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { restoreAppCheckpoint } from '@/lib/app-dev-api';
import { useAppDevWorkbenchStore } from '@/stores/app-dev-workbench';
import { useAppDevVersionsStore } from '@/stores/app-dev-versions';

export interface AppDevVersionRestoreTarget {
  hash: string;
  /** 确认框里展示的标签：checkpoint subject，缺失时退化为短 hash。 */
  label: string;
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
  const [target, setTarget] = useState<AppDevVersionRestoreTarget | null>(null);
  const onRestoredRef = useRef(onRestored);
  onRestoredRef.current = onRestored;

  useEffect(() => {
    if (!request) return;
    useAppDevWorkbenchStore.getState().setVersionRestoreRequest(null);
    const records = useAppDevVersionsStore.getState().versionsByWorkspace[workspaceId] ?? {};
    const record = Object.values(records).find((item) => item.hash === request.hash);
    setTarget({
      hash: request.hash,
      label: record?.subject?.trim() || request.hash.slice(0, 7),
    });
  }, [request, workspaceId]);

  const cancel = useCallback(() => setTarget(null), []);

  const confirm = useCallback(async () => {
    if (!target) return;
    const result = await restoreAppCheckpoint(workspaceId, target.hash).catch(() => null);
    if (result?.restored) {
      toast.success('已恢复到所选版本，页面稍后自动刷新');
      onRestoredRef.current?.();
    } else {
      toast.error('暂时无法恢复，请稍后再试');
    }
    setTarget(null);
  }, [target, workspaceId]);

  return { target, confirm, cancel };
}
