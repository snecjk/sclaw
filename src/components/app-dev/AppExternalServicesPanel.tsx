import { useCallback, useEffect, useState } from 'react';
import { Loader2, PlugZap, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  bindAppExternalService,
  listAppExternalServiceBindings,
  removeAppExternalService,
  searchAppExternalServices,
  upgradeAppExternalService,
} from '@/lib/app-dev-api';
import type { ExternalServiceBindingSnapshot, ExternalServiceSummary } from '../../../shared/external-service-contract';

function defaultAlias(serviceId: string): string {
  return serviceId.replace(/-([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
}

export function AppExternalServicesPanel({ workspaceId }: { workspaceId: string }) {
  const [bindings, setBindings] = useState<ExternalServiceBindingSnapshot[]>([]);
  const [items, setItems] = useState<ExternalServiceSummary[]>([]);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [upgradeVersions, setUpgradeVersions] = useState<Record<string, string>>({});

  const loadBindings = useCallback(async () => {
    setBindings(await listAppExternalServiceBindings(workspaceId));
  }, [workspaceId]);

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const result = await searchAppExternalServices(workspaceId, keyword);
      setItems(result.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '外部服务搜索失败');
    } finally {
      setLoading(false);
    }
  }, [keyword, workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void Promise.all([
        listAppExternalServiceBindings(workspaceId),
        searchAppExternalServices(workspaceId, ''),
      ]).then(([nextBindings, result]) => {
        setBindings(nextBindings);
        setItems(result.items);
      }).catch((error) => {
        toast.error(error instanceof Error ? error.message : '外部服务加载失败');
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [workspaceId]);

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusyKey(key);
    try {
      await action();
      toast.success(success);
      await loadBindings();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusyKey('');
    }
  };

  const boundIds = new Set(bindings.map((item) => item.serviceId));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mx-auto max-w-5xl space-y-6">
        <section>
          <h2 className="text-sm font-semibold">已绑定服务</h2>
          <p className="mt-1 text-xs text-muted-foreground">固定版本会随应用代码发布；升级必须明确选择目标版本。</p>
          <div className="mt-3 space-y-2">
            {bindings.length === 0 ? <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">当前应用尚未绑定外部服务</div> : bindings.map((binding) => (
              <article key={binding.alias} className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
                <PlugZap className="h-4 w-4 text-violet-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{binding.name} <span className="font-mono text-xs text-muted-foreground">{binding.alias}</span></p>
                  <p className="mt-1 text-xs text-muted-foreground">v{binding.version} · {binding.auth.type} · {binding.integration?.npmPackage ?? '无 SDK'}</p>
                </div>
                <input aria-label={`${binding.alias} 升级版本`} placeholder="目标版本" value={upgradeVersions[binding.alias] ?? ''} onChange={(e) => setUpgradeVersions((current) => ({ ...current, [binding.alias]: e.target.value }))} className="h-8 w-28 rounded-md border border-border bg-background px-2 text-xs" />
                <Button type="button" size="sm" variant="outline" disabled={!upgradeVersions[binding.alias]?.trim() || busyKey === binding.alias} onClick={() => void run(binding.alias, () => upgradeAppExternalService({ workspaceId, alias: binding.alias, version: upgradeVersions[binding.alias].trim() }), '服务版本已升级')}>升级</Button>
                <Button type="button" size="sm" variant="ghost" aria-label={`移除 ${binding.alias}`} disabled={busyKey === binding.alias} onClick={() => void run(binding.alias, () => removeAppExternalService({ workspaceId, alias: binding.alias }), '已移除服务')}><Trash2 className="h-4 w-4" /></Button>
              </article>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold">服务广场</h2>
          <div className="mt-3 flex gap-2">
            <input placeholder="搜索外部服务" value={keyword} onChange={(e) => setKeyword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void search(); }} className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm" />
            <Button type="button" size="sm" disabled={loading} onClick={() => void search()}>{loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />}搜索</Button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {items.map((item) => {
              const bound = boundIds.has(item.serviceId);
              return <article key={item.serviceId} className="rounded-lg border border-border bg-background p-4">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1"><p className="text-sm font-medium">{item.name}</p><p className="mt-1 text-xs text-muted-foreground">{item.description || '暂无说明'}</p><p className="mt-2 text-[11px] text-muted-foreground">{item.owner} · {item.authType} · {item.latestVersion ? `v${item.latestVersion}` : '未发布'}</p></div>
                  <Button type="button" size="sm" disabled={bound || !item.latestVersion || busyKey === item.serviceId} onClick={() => void run(item.serviceId, () => bindAppExternalService({ workspaceId, serviceId: item.serviceId, version: item.latestVersion!, alias: defaultAlias(item.serviceId) }), '服务已添加到应用')}>{bound ? '已添加' : '添加到应用'}</Button>
                </div>
              </article>;
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
