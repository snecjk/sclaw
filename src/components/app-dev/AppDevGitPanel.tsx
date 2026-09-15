/**
 * Git code management tab — cloud source commits + local/cloud publish history.
 */
import { useEffect, useState } from 'react';
import { CloudUpload, GitBranch, Loader2, Rocket, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  createAppCheckpoint,
  listAppCheckpoints,
  listStoAppCloudDeployments,
  listStoAppPushes,
  restoreStoAppRevision,
  rollbackStoAppCloudDeployment,
  type AppCheckpoint,
  type StoAppDeployHistoryRecord,
  type StoAppPushHistoryItem,
} from '@/lib/app-dev-api';
import { submitStoAppWithAutoPull } from '@/lib/sto-app-submit';
import { hostApiFetch } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import {
  codeDeployProgressLabel,
  isCodeDeploySuccess,
  presentCodeDeployFields,
} from '../../../shared/code-deploy-status';
import type { SiteAppDeploymentRecord } from '../../../shared/site-app-deployments';
import { isStoAppDeployHistoryInProgress } from '../../../shared/sto-app-deploy-history';

interface AppDevGitPanelProps {
  workspaceId: string;
  canDeploy?: boolean;
  /** 建站应用：上传代码走云端源码提交，与右上角提交同一条链路。 */
  cloudPush?: boolean;
  /** DevOps Founder Group；云端发布列表 / 回滚必传。 */
  deployGroupName?: string | null;
  /** Bump after header 提交 / 发布 so 最近提交 reloads. */
  recordsRevision?: number;
  deployRunning?: boolean;
  deployHistory?: StoAppDeployHistoryRecord[];
  onOpenDeploy?: () => void;
  onOpenDeployHistory?: (deploymentId: string) => void;
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

function toCheckpoint(item: StoAppPushHistoryItem): AppCheckpoint & { revisionId?: string } {
  return {
    hash: item.hash || item.commitSha || item.revisionId,
    timestamp: item.timestamp || item.createdAt,
    subject: item.subject || item.message,
    revisionId: item.revisionId,
  };
}

export function AppDevGitPanel({
  workspaceId,
  canDeploy = false,
  cloudPush = false,
  deployGroupName = null,
  recordsRevision = 0,
  deployRunning = false,
  deployHistory = [],
  onOpenDeploy,
  onOpenDeployHistory,
}: AppDevGitPanelProps) {
  const [message, setMessage] = useState('上传代码');
  const [checkpoints, setCheckpoints] = useState<Array<AppCheckpoint & { revisionId?: string }>>([]);
  const [commitSource, setCommitSource] = useState<'cloud' | 'local' | 'git'>('git');
  const [loadingList, setLoadingList] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [cloudDeploys, setCloudDeploys] = useState<SiteAppDeploymentRecord[]>([]);
  const [loadingDeploys, setLoadingDeploys] = useState(false);
  const [rollingBackId, setRollingBackId] = useState<number | null>(null);
  const [resolvedGroupName, setResolvedGroupName] = useState<string | null>(deployGroupName ?? null);

  const refresh = async () => {
    setLoadingList(true);
    try {
      if (cloudPush) {
        const timeline = await listStoAppPushes(workspaceId);
        setCommitSource(timeline.source);
        setCheckpoints(timeline.items.map(toCheckpoint).slice(0, 20));
      } else {
        setCommitSource('git');
        setCheckpoints(await listAppCheckpoints(workspaceId));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '无法读取提交记录');
    } finally {
      setLoadingList(false);
    }
  };

  const refreshDeployments = async (groupNameOverride?: string | null) => {
    if (!cloudPush) return;
    const groupName = (groupNameOverride ?? resolvedGroupName ?? deployGroupName)?.trim();
    if (!groupName) {
      setCloudDeploys([]);
      return;
    }
    setLoadingDeploys(true);
    try {
      setCloudDeploys(await listStoAppCloudDeployments(workspaceId, groupName));
      setResolvedGroupName(groupName);
    } catch {
      setCloudDeploys([]);
    } finally {
      setLoadingDeploys(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await refresh();
      if (!cloudPush) return;
      let group = deployGroupName?.trim() || null;
      if (!group) {
        try {
          const res = await hostApiFetch<{ groupName?: string | null }>(
            `/api/app-dev/sto-app/deploy-group?workspaceId=${encodeURIComponent(workspaceId)}`,
          );
          group = res.groupName?.trim() || null;
        } catch {
          group = null;
        }
      }
      if (cancelled) return;
      setResolvedGroupName(group);
      await refreshDeployments(group);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, cloudPush, recordsRevision, deployGroupName]);

  const handleUpload = async () => {
    if (uploading) return;
    setUploading(true);
    try {
      const note = message.trim() || '上传代码';
      if (cloudPush) {
        const outcome = await submitStoAppWithAutoPull(workspaceId, note);
        if (outcome.kind === 'submitted') {
          toast.success('已提交到 STO 应用');
          setMessage('上传代码');
          await refresh();
        } else if (outcome.kind === 'conflicts') {
          toast.message(outcome.message);
        } else {
          toast.error(outcome.message);
        }
      } else {
        const { created } = await createAppCheckpoint(workspaceId, note);
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

  const handleRestoreRevision = async (item: AppCheckpoint & { revisionId?: string }) => {
    const revisionId = item.revisionId?.trim();
    if (!revisionId || restoringId) return;
    setRestoringId(revisionId);
    try {
      const result = await restoreStoAppRevision(workspaceId, revisionId, {
        push: true,
        message: `恢复到 ${item.subject || revisionId.slice(0, 8)}`,
      });
      if (result.ok) {
        toast.success('已恢复并提交到云端（本地源码已同步）');
        await refresh();
      } else {
        toast.error(result.output || '恢复失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '恢复失败');
    } finally {
      setRestoringId(null);
    }
  };

  const handleRollbackDeploy = async (item: SiteAppDeploymentRecord) => {
    const groupName = (resolvedGroupName ?? deployGroupName)?.trim();
    if (!groupName || rollingBackId != null) return;
    setRollingBackId(item.id);
    try {
      const result = await rollbackStoAppCloudDeployment(workspaceId, {
        groupName,
        targetRecordId: item.id,
        syncLocal: true,
      });
      if (result.rollback.status === 'success') {
        toast.success(
          result.localSync?.ok
            ? '线上已回滚，本地源码已同步'
            : '线上已回滚；若本地未同步，请从对应提交恢复',
        );
        await refreshDeployments();
        await refresh();
      } else if (result.rollback.status === 'unknown') {
        toast.message(result.rollback.message || '回滚结果待确认，请刷新发布记录');
        await refreshDeployments();
      } else {
        toast.error(result.rollback.message || `回滚失败：${result.rollback.status}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '回滚失败');
    } finally {
      setRollingBackId(null);
    }
  };

  const publishDisabled = deployRunning || !canDeploy || !onOpenDeploy;
  const showCloudDeployList = Boolean(cloudPush && (resolvedGroupName ?? deployGroupName)?.trim());

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
              ? '「上传代码」与右上角「提交」相同：把源码提交到云端。「最近提交」优先读云端修订；「发布记录」展示版本/tag，支持按版本回滚线上并尽量同步本地。'
              : '「上传代码」会将当前改动提交到本地 Git。「发布」会把代码推到云端并走 DevOps 流水线。'}
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
                    : '当前无法发布（未绑定云端应用）'
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
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              发布记录
            </h3>
            {showCloudDeployList ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px]"
                disabled={loadingDeploys || rollingBackId != null}
                onClick={() => void refreshDeployments()}
              >
                {loadingDeploys ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : '刷新'}
              </Button>
            ) : null}
          </div>
          {showCloudDeployList ? (
            cloudDeploys.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                {loadingDeploys ? '加载中…' : '暂无云端发布记录（最近 5 条）。发布成功后的版本/tag 会出现在这里。'}
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {cloudDeploys.map((item) => (
                  <li key={item.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">
                        {item.iterateName || `部署 #${item.id}`}
                        {item.isOnline ? ' · 当前线上' : ''}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        #{item.id}
                        {item.createUser ? ` · ${item.createUser}` : ''}
                        {item.createTime ? ` · ${formatTime(item.createTime)}` : ''}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 gap-1 text-xs"
                      disabled={
                        rollingBackId != null
                        || item.isOnline
                        || item.available === false
                      }
                      onClick={() => void handleRollbackDeploy(item)}
                    >
                      {rollingBackId === item.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                      ) : (
                        <RotateCcw className="h-3 w-3" aria-hidden />
                      )}
                      回滚此版
                    </Button>
                  </li>
                ))}
              </ul>
            )
          ) : deployHistory.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {cloudPush
                ? '暂无发布记录。配置 DevOps group_name 后可拉取云端发布列表；本机发起的发布仍保存在 `.sto/deploy-history.json`。'
                : '暂无发布记录。从本机发起的发布会保存在应用目录 `.sto/deploy-history.json`。'}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {deployHistory.map((item) => {
                const runningItem = isStoAppDeployHistoryInProgress(item);
                const success = isCodeDeploySuccess(item.status);
                return (
                  <li key={item.deploymentId}>
                    <button
                      type="button"
                      className="flex w-full cursor-pointer items-start justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      onClick={() => onOpenDeployHistory?.(item.deploymentId)}
                    >
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
                          runningItem && 'text-muted-foreground',
                          !runningItem && success && 'text-muted-foreground',
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
                    </button>
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
              {cloudPush ? (
                <span className="ml-2 normal-case tracking-normal text-[10px] text-muted-foreground">
                  {commitSource === 'cloud' ? '云端' : '本机兜底'}
                </span>
              ) : null}
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
                <li key={`${item.revisionId || item.hash}`} className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{item.subject}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {(item.hash || '').slice(0, 8)} · {formatTime(item.timestamp)}
                    </p>
                  </div>
                  {cloudPush && item.revisionId ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 gap-1 text-xs"
                      disabled={restoringId != null}
                      onClick={() => void handleRestoreRevision(item)}
                    >
                      {restoringId === item.revisionId ? (
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                      ) : (
                        <RotateCcw className="h-3 w-3" aria-hidden />
                      )}
                      恢复并提交
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
