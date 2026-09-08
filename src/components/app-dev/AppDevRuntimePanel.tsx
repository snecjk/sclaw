/**
 * Fullstack runtime panel：起停、后端 URL、日志尾、应用密钥（无回显）。
 */
import { memo, useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, Play, RotateCw, Square, Terminal } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  deleteAppSecret,
  getAppRuntimeLogs,
  getAppRuntimeStatus,
  listAppSecrets,
  migrateAppDb,
  restartAppRuntime,
  setAppSecret,
  startAppRuntime,
  stopAppRuntime,
  type AppRuntimeStatus,
} from '@/lib/app-dev-api';
import { cn } from '@/lib/utils';

export const AppDevRuntimePanel = memo(function AppDevRuntimePanel({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const [fullstack, setFullstack] = useState(false);
  const [status, setStatus] = useState<AppRuntimeStatus | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [keys, setKeys] = useState<string[]>([]);
  const [secretKey, setSecretKey] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getAppRuntimeStatus(workspaceId);
      setFullstack(result.fullstack);
      setStatus(result.status);
      setLogs(await getAppRuntimeLogs(workspaceId, 'all'));
      setKeys(await listAppSecrets(workspaceId));
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => { void reload(); }, 4000);
    return () => clearInterval(timer);
  }, [reload]);

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(okMsg);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!fullstack && !status?.backendUrl && !status?.backendRunning) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center" data-testid="app-dev-runtime-panel">
        <Terminal className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-foreground">当前不是全栈应用</p>
        <p className="text-xs text-muted-foreground">创建          创建应用时选择「全栈应用」，或使用 site-fullstack 模板后可在此管理运行时与密钥。
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="app-dev-runtime-panel">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">运行时</span>
        <span className="flex-1" />
        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void reload()} disabled={loading}>
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : '刷新'}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4 space-y-4">
        <section className="rounded-lg border border-border p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={cn(
              'rounded px-1.5 py-0.5',
              status?.phase === 'ready' ? 'bg-[var(--sto-success-soft,#E8F8EF)] text-[var(--sto-success-primary,#00B54B)]' : 'bg-muted text-muted-foreground',
            )}
            >
              {status?.phase ?? 'unknown'}
            </span>
            <span className="text-muted-foreground">
              FE
              {' '}
              {status?.frontendRunning ? '●' : '○'}
              {' · '}
              BE
              {' '}
              {status?.backendRunning ? '●' : '○'}
              {' · '}
              DB
              {' '}
              {status?.dbStatus ?? 'unknown'}
            </span>
          </div>
          {status?.backendUrl ? (
            <p className="truncate font-mono text-[11px] text-muted-foreground" title={status.backendUrl}>
              {status.backendUrl}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" className="h-7 gap-1 text-xs" disabled={busy} onClick={() => void run(() => startAppRuntime(workspaceId), '已启动')}>
              <Play className="h-3 w-3" />
              启动
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={busy} onClick={() => void run(() => stopAppRuntime(workspaceId), '已停止')}>
              <Square className="h-3 w-3" />
              停止
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={busy} onClick={() => void run(() => restartAppRuntime(workspaceId), '已重启')}>
              <RotateCw className="h-3 w-3" />
              重启
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => void run(() => migrateAppDb(workspaceId), 'Migrate 完成')}>
              Migrate
            </Button>
          </div>
        </section>

        <section className="rounded-lg border border-border p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium">
            <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
            应用密钥
          </div>
          <p className="text-[11px] text-muted-foreground">仅注入后端进程环境变量，列表不回显值。</p>
          <div className="flex flex-wrap gap-2">
            <input
              className="sto-control-field h-8 min-w-[120px] flex-1 rounded-md border border-border bg-background px-2 text-xs"
              placeholder="KEY"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
            />
            <input
              type="password"
              className="sto-control-field h-8 min-w-[140px] flex-1 rounded-md border border-border bg-background px-2 text-xs"
              placeholder="value"
              value={secretValue}
              onChange={(e) => setSecretValue(e.target.value)}
              autoComplete="off"
            />
            <Button
              type="button"
              size="sm"
              className="h-8 text-xs"
              disabled={busy || !secretKey.trim() || !secretValue}
              onClick={() => void run(async () => {
                await setAppSecret(workspaceId, secretKey, secretValue);
                setSecretKey('');
                setSecretValue('');
              }, '已保存密钥')}
            >
              保存
            </Button>
          </div>
          <ul className="space-y-1">
            {keys.map((key) => (
              <li key={key} className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1 text-xs">
                <span className="font-mono">{key}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[11px] text-[var(--sto-danger-primary,#FA3C3C)]"
                  disabled={busy}
                  onClick={() => void run(() => deleteAppSecret(workspaceId, key), '已删除')}
                >
                  删除
                </Button>
              </li>
            ))}
            {keys.length === 0 ? <li className="text-[11px] text-muted-foreground">暂无密钥</li> : null}
          </ul>
        </section>

        <section className="rounded-lg border border-border p-3">
          <p className="mb-2 text-xs font-medium">日志（尾部）</p>
          <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
            {logs.length > 0 ? logs.slice(-80).join('\n') : '暂无日志'}
          </pre>
        </section>
      </div>
    </div>
  );
});
