/**
 * Git code management tab — local commit ("上传代码") + trigger DevOps build button.
 * Remote push / pipeline integration is deferred; build is a stub action for now.
 */
import { useEffect, useState } from 'react';
import { CloudUpload, GitBranch, Loader2, Rocket } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  createAppCheckpoint,
  listAppCheckpoints,
  type AppCheckpoint,
} from '@/lib/app-dev-api';
import { delay } from '@/components/app-dev/app-dev-deploy-defaults';

interface AppDevGitPanelProps {
  workspaceId: string;
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export function AppDevGitPanel({ workspaceId }: AppDevGitPanelProps) {
  const [message, setMessage] = useState('上传代码');
  const [checkpoints, setCheckpoints] = useState<AppCheckpoint[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [building, setBuilding] = useState(false);

  const refresh = async () => {
    setLoadingList(true);
    try {
      const list = await listAppCheckpoints(workspaceId);
      setCheckpoints(list);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '无法读取提交记录');
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoadingList(true);
    void listAppCheckpoints(workspaceId)
      .then((list) => {
        if (!cancelled) setCheckpoints(list);
      })
      .catch((err) => {
        if (!cancelled) toast.error(err instanceof Error ? err.message : '无法读取提交记录');
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const handleUpload = async () => {
    if (uploading) return;
    setUploading(true);
    try {
      const created = await createAppCheckpoint(workspaceId, message.trim() || '上传代码');
      if (created) {
        toast.success('代码已提交到本地 Git');
        setMessage('上传代码');
        await refresh();
      } else {
        toast.message('没有可提交的改动，或 Git 不可用');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提交失败');
    } finally {
      setUploading(false);
    }
  };

  const handleBuild = async () => {
    if (building) return;
    setBuilding(true);
    try {
      await delay(900);
      toast.success('已触发构建（占位）', {
        description: '后续将对接公司 DevOps 发布平台流水线。',
      });
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header className="space-y-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <GitBranch className="h-4 w-4" aria-hidden />
            Git 代码管理
          </h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            「上传代码」会将当前改动提交到本地 Git。构建由公司 DevOps 平台执行，此处仅提供触发入口。
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
              disabled={uploading}
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
              disabled={building}
              onClick={() => void handleBuild()}
            >
              {building ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Rocket className="h-3.5 w-3.5" aria-hidden />
              )}
              执行构建
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            构建按钮当前为占位：点击后提示成功，后续对接公司 DevOps 发布平台流水线。
          </p>
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
