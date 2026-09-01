/**
 * Git code management tab — local commit plus real Site App publish + local publish history.
 */
import { useEffect, useState } from 'react';
import { CloudUpload, GitBranch, Loader2, Rocket } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  createAppCheckpoint,
  listAppCheckpoints,
  listStoAppPushes,
  pushStoApp,
  type AppCheckpoint,
  type StoAppDeployHistoryRecord,
} from '@/lib/app-dev-api';
import { cn } from '@/lib/utils';
import {
  codeDeployProgressLabel,
  isCodeDeploySuccess,
  presentCodeDeployFields,
} from '../../../shared/code-deploy-status';
import { isStoAppDeployHistoryInProgress } from '../../../shared/sto-app-deploy-history';
import { stoAppPushToCheckpoint } from '../../../shared/sto-app-push-history';

interface AppDevGitPanelProps {
  workspaceId: string;
  canDeploy?: boolean;
  /** 建站应用：上传代码走 sai-cli push，与右上角提交同一条链路。 */
  cloudPush?: boolean;
  /** Bump after header 提交 / 发布 so 最近提交 reloads. */
  recordsRevision?: number;
  deployRunning?: boolean;
  deployHistory?: StoAppDeployHistoryRecord[];
  onOpenDeploy?: () => void;
}

function mergeCommitRows(cloud: AppCheckpoint[], git: AppCheckpoint[]): AppCheckpoint[] {
  const rows: AppCheckpoint[] = [];
  const seen = new Set<string>();
  for (const item of [...cloud, ...git]) {
    const key = item.hash.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push(item);
  }
  return rows.sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function historyStatusLabel(item: StoAppDeployHistoryRecord): string {
  const presented = presentCodeDeployFields(item);
  return codeDeployProgressLabel(presented);
}

export function AppDevGitPanel({
  workspaceId,
  canDeploy = false,
  cloudPush = false,
  recordsRevision = 0,
  deployRunning = false,
  deployHistory = [],
  onOpenDeploy,
}: AppDevGitPanelProps) {
  const [message, setMessage] = useState('上传代码');
  const [checkpoints, setCheckpoints] = useState<AppCheckpoint[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [uploading, setUploading] = useState(false);

  const refresh = async () => {
    setLoadingList(true);
    try {
      if (cloudPush) {
        const [pushes, git] = await Promise.all([
          listStoAppPushes(workspaceId),
          listAppCheckpoints(workspaceId).catch(() => [] as AppCheckpoint[]),
        ]);
        setCheckpoints(mergeCommitRows(pushes.map(stoAppPushToCheckpoint), git));
      } else {
        setCheckpoints(await listAppCheckpoints(workspaceId));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '无法读取提交记录');
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    void refresh();
    // refresh is recreated each render; key the load on workspace / cloud / parent bump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, cloudPush, recordsRevision]);

  const handleUpload = async () => {
    if (uploading) return;
    setUploading(true);
    try {
      const note = message.trim() || '上传代码';
      if (cloudPush) {
        await pushStoApp(workspaceId, note);
        toast.success('已提交到 STO 应用');
        setMessage('上传代码');
        await refresh();
      } else {
        const created = await createAppCheckpoint(workspaceId, note);
        if (created) {
          toast.success('代码已提交到本地 Git');
          setMessage('上传代码');
          await refresh();
        } else {
          toast.message('没有可提交的改动，或 Git 不可用');
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提交失败');
    } finally {
      setUploading(false);
    }
  };

  const publishDisabled = deployRunning || !canDeploy || !onOpenDeploy;

  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header className="space-y-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <GitBranch className="h-4 w-4" aria-hidden />
            Git 代码管理
          </h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {cloudPush
              ? '「上传代码」与右上角「提交」相同：调用 sai-cli 把代码提交到云端，并写入下方「最近提交」。「发布」会先提交再走 DevOps 流水线。'
              : '「上传代码」会将当前改动提交到本地 Git。「发布」会把代码推到云端并走 DevOps 流水线；进行中的发布会写入本地记录并继续查询到成功或失败。'}
          </p>
        </header>

        <section className="space-y-3 rounded-xl border border-border bg-background/70 p-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-foreground">提交说明</span>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="resize-none text-sm"
              placeholder="简述本次上传内容"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              disabled={uploading || (cloudPush && deployRunning)}
              onClick={() => void handleUpload()}
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <CloudUpload className="h-3.5 w-3.5" aria-hidden />
              )}
              上传代码
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={publishDisabled}
              title={
                deployRunning
                  ? '已有发布进行中'
                  : canDeploy
                    ? '选择环境并发布到云端'
                    : '当前无法发布（未绑定云端应用或 sai-cli 不可用）'
              }
              onClick={() => onOpenDeploy?.()}
            >
              {deployRunning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Rocket className="h-3.5 w-3.5" aria-hidden />
              )}
              {deployRunning ? '发布中' : '发布'}
            </Button>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-background/70 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            发布记录
          </h3>
          {deployHistory.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              暂无发布记录。从本机发起的发布会保存在应用目录 `.sto/deploy-history.json`。
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {deployHistory.map((item) => {
                const runningItem = isStoAppDeployHistoryInProgress(item);
                const success = isCodeDeploySuccess(item.status);
                return (
                  <li key={item.deploymentId} className="flex items-start justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">
                        {item.env || '未指定环境'}
                        {item.deploymentVersion ? ` · ${item.deploymentVersion}` : ''}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {item.deploymentId}
                        {item.startedAt ? ` · ${formatTime(item.startedAt)}` : ''}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 text-[11px]',
                        runningItem && 'text-amber-700 dark:text-amber-300',
                        !runningItem && success && 'text-emerald-700 dark:text-emerald-300',
                        !runningItem && !success && 'text-destructive',
                      )}
                    >
                      {runningItem ? (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                          {historyStatusLabel(item)}
                        </span>
                      ) : (
                        historyStatusLabel(item)
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-background/70 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              最近提交
            </h3>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              disabled={loadingList}
              onClick={() => void refresh()}
            >
              {loadingList ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : '刷新'}
            </Button>
          </div>
          {checkpoints.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {loadingList ? '加载中…' : '暂无提交记录'}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {checkpoints.map((item) => (
                <li key={item.hash} className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{item.subject}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {item.hash.slice(0, 8)} · {formatTime(item.timestamp)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
