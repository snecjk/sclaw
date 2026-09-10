/**
 * AppDevTurnVersionActions — 轮次汇总卡操作行 [恢复版本｜查看修改]（P1 交互改造 T04）。
 *
 * hash 解析：优先 app-dev-versions store 的 turnKey↔commit 映射；
 * 缺失时（旧会话/持久化丢失）拉 listAppCheckpoints 按轮结束时间最近邻降级对齐。
 * 两个按钮都是「请求-消费」：查看修改 → diffRequest + 切版本页签；
 * 恢复版本 → versionRestoreRequest（AppPlazaDevAppPane 弹二次确认后回滚）。
 */
import { memo, useEffect, useState } from 'react';
import { FileDiff, History } from 'lucide-react';
import { listAppCheckpoints } from '@/lib/app-dev-api';
import { resolveTurnCheckpoint } from '@/lib/app-dev-turn-versions';
import { useAppDevVersionsStore } from '@/stores/app-dev-versions';
import { useAppDevWorkbenchStore } from '@/stores/app-dev-workbench';
import { cn } from '@/lib/utils';

export interface AppDevTurnVersionActionsProps {
  workspaceId: string;
  /** assistant-turn 稳定 key（buildTurnStableKey 对齐）。 */
  turnKey: string;
  /** 轮次结束时间（ms），降级最近邻对齐用。 */
  turnEndedAt: number | null;
  className?: string;
}

const ACTION_BUTTON_CLASS =
  'inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-[var(--sto-text-secondary)] transition-colors hover:bg-[var(--sto-control-hover-bg)] hover:text-foreground';

export const AppDevTurnVersionActions = memo(function AppDevTurnVersionActions({
  workspaceId,
  turnKey,
  turnEndedAt,
  className,
}: AppDevTurnVersionActionsProps) {
  const mapped = useAppDevVersionsStore(
    (s) => s.versionsByWorkspace[workspaceId]?.[turnKey] ?? null,
  );
  const [fallback, setFallback] = useState<{ hash: string; subject: string } | null>(null);

  // 映射缺失：降级按时间戳最近邻对齐 checkpoint 列表。
  useEffect(() => {
    if (mapped || !workspaceId || turnEndedAt == null) return;
    let alive = true;
    void listAppCheckpoints(workspaceId)
      .then((checkpoints) => {
        if (!alive) return;
        setFallback(resolveTurnCheckpoint({ mapped: null, checkpoints, turnEndedAt }));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [mapped, workspaceId, turnEndedAt]);

  const resolved = mapped
    ? { hash: mapped.hash, subject: mapped.subject }
    : fallback;
  if (!resolved) return null;

  const handleViewDiff = () => {
    const workbench = useAppDevWorkbenchStore.getState();
    workbench.setDiffRequest({ hash: resolved.hash });
    workbench.setMode('versions');
    // 工作区收起状态下点「查看修改」要能看到结果。
    if (workbench.stageCollapsed) workbench.setStageCollapsed(false);
  };

  const handleRestore = () => {
    useAppDevWorkbenchStore.getState().setVersionRestoreRequest({ hash: resolved.hash });
  };

  return (
    <span
      className={cn('inline-flex items-center gap-1', className)}
      data-testid="app-dev-turn-version-actions"
    >
      <button
        type="button"
        className={ACTION_BUTTON_CLASS}
        title={`回滚到该轮对话结束时的版本（${resolved.subject || resolved.hash.slice(0, 7)}），当前改动会自动备份`}
        onClick={handleRestore}
      >
        <History className="h-3.5 w-3.5" aria-hidden />
        恢复版本
      </button>
      <button
        type="button"
        className={ACTION_BUTTON_CLASS}
        title="在工作台「版本」页查看本轮的行级修改对比"
        onClick={handleViewDiff}
      >
        <FileDiff className="h-3.5 w-3.5" aria-hidden />
        查看修改
      </button>
    </span>
  );
});
