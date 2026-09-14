/**
 * 版本时间线面板（T10）：列出 checkpoint，支持查看/恢复/两版对比。
 */
import { memo, useEffect, useMemo, useState } from 'react';
import { FileDiff, History, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { listAppCheckpoints, type AppCheckpoint } from '@/lib/app-dev-api';
import { useAppDevVersionsStore } from '@/stores/app-dev-versions';
import { useAppDevWorkbenchStore } from '@/stores/app-dev-workbench';
import { cn } from '@/lib/utils';

const EMPTY_VERSIONS: Record<string, never> = {};

function formatRelativeTime(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 60_000) return '刚刚';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  return new Date(ts).toLocaleString();
}

function isAutoSaveSubject(subject: string): boolean {
  return /中断|自动保存|恢复前自动保存|任务中断/.test(subject);
}

export const AppDevVersionsPanel = memo(function AppDevVersionsPanel({
  workspaceId,
  className,
}: {
  workspaceId: string;
  className?: string;
}) {
  const [checkpoints, setCheckpoints] = useState<AppCheckpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const setDiffRequest = useAppDevWorkbenchStore((s) => s.setDiffRequest);
  const setVersionRestoreRequest = useAppDevWorkbenchStore((s) => s.setVersionRestoreRequest);
  const versions = useAppDevVersionsStore(
    (s) => s.versionsByWorkspace[workspaceId] ?? EMPTY_VERSIONS,
  );

  const hashToTurn = useMemo(() => {
    const map = new Map<string, { turnKey: string; excerpt: string }>();
    for (const [turnKey, ver] of Object.entries(versions)) {
      map.set(ver.hash, { turnKey, excerpt: ver.userTextExcerpt });
    }
    return map;
  }, [versions]);

  const reload = async () => {
    setLoading(true);
    try {
      const list = await listAppCheckpoints(workspaceId);
      setCheckpoints(list);
    } catch {
      setCheckpoints([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, [workspaceId]);

  const toggleSelect = (hash: string) => {
    setSelected((prev) => {
      if (prev.includes(hash)) return prev.filter((h) => h !== hash);
      if (prev.length >= 2) return [prev[1], hash];
      return [...prev, hash];
    });
  };

  const compareSelected = () => {
    if (selected.length !== 2) return;
    // 较旧 → base，较新 → head（按列表时间倒序，索引更大的更旧）
    const [a, b] = selected;
    const ia = checkpoints.findIndex((c) => c.hash === a);
    const ib = checkpoints.findIndex((c) => c.hash === b);
    const older = ia > ib ? a : b;
    const newer = ia > ib ? b : a;
    setDiffRequest({ hash: newer, baseHash: older });
  };

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)} data-testid="app-dev-versions-panel">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <History className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <span className="text-xs font-medium">版本历史</span>
        <span className="flex-1" />
        {selected.length === 2 ? (
          <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={compareSelected}>
            <FileDiff className="h-3.5 w-3.5" />
            对比两版
          </Button>
        ) : (
          <span className="text-[11px] text-muted-foreground">勾选两版可对比</span>
        )}
        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void reload()} disabled={loading}>
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : '刷新'}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {checkpoints.length === 0 && !loading ? (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">
            还没有版本记录。对话改动后会自动生成 checkpoint。
          </p>
        ) : null}
        <ol className="space-y-2">
          {checkpoints.map((cp, index) => {
            const versionNo = checkpoints.length - index - 1;
            const auto = isAutoSaveSubject(cp.subject);
            const mapped = hashToTurn.get(cp.hash);
            const checked = selected.includes(cp.hash);
            return (
              <li
                key={cp.hash}
                className={cn(
                  'rounded-lg border border-border bg-card p-2',
                  checked && 'border-[var(--sto-brand-primary)]',
                )}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked}
                    onChange={() => toggleSelect(cp.hash)}
                    aria-label={`选择版本 v${versionNo}`}
                  />
                  <div className="flex h-10 w-16 shrink-0 items-center justify-center rounded bg-muted text-[10px] text-muted-foreground">
                    v{versionNo}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs font-medium">v{versionNo}</span>
                      {auto ? (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          任务中断前自动保存
                        </span>
                      ) : null}
                      <span className="text-[11px] text-muted-foreground">
                        {formatRelativeTime(cp.timestamp)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-foreground" title={cp.subject}>
                      {mapped?.excerpt || cp.subject}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                      {cp.hash.slice(0, 8)}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex justify-end gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 text-xs"
                    onClick={() => setDiffRequest({ hash: cp.hash })}
                  >
                    <FileDiff className="h-3.5 w-3.5" />
                    查看改动
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs"
                    onClick={() => setVersionRestoreRequest({ hash: cp.hash })}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    恢复此版
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
});
