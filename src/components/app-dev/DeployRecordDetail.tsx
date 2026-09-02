import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { codeDeployStatusLabel, type CodeDeployRecordFields } from '../../../shared/code-deploy-status';
import type { DeployResourcePage } from '../../../shared/sto-app-deploy-resources';
import type { StoAppDeployHistoryRecord } from '../../../shared/sto-app-deploy-history';
import { DeployResourceList } from './DeployResourceList';

export function DeployRecordDetail({ record, fields, pages, loading, resourceError, onRefresh, onCopy, onOpen }: {
  record: StoAppDeployHistoryRecord | null;
  fields: CodeDeployRecordFields | null;
  pages: DeployResourcePage[];
  loading: boolean;
  resourceError?: string;
  onRefresh: () => void;
  onCopy: (url: string) => void;
  onOpen: (url: string) => void;
}) {
  if (!record) return <div className="grid h-full place-items-center text-sm text-muted-foreground">请选择一条发布记录</div>;
  const current = fields ?? record;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{codeDeployStatusLabel(current.status)}</h3>
            <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{record.deploymentId}</p>
          </div>
          <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" disabled={loading} onClick={onRefresh}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
            刷新
          </Button>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-xs lg:grid-cols-3">
          <div><dt className="text-muted-foreground">环境</dt><dd className="mt-0.5">{current.env ?? '-'}</dd></div>
          <div><dt className="text-muted-foreground">发布版本</dt><dd className="mt-0.5 font-mono">{current.deploymentVersion ?? '-'}</dd></div>
          <div><dt className="text-muted-foreground">流水线实例</dt><dd className="mt-0.5 font-mono">{current.pipelineInstanceId ?? '-'}</dd></div>
        </dl>
        {current.failureMessage ? <div className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{current.failureMessage}</div> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-3 flex items-center justify-between"><h4 className="text-sm font-semibold">发布产物</h4><span className="text-xs text-muted-foreground">{pages.length} 个文件</span></div>
        {loading ? <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />正在查询发布状态与产物…</div> : null}
        {!loading && resourceError ? <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/20 dark:text-amber-200">发布状态或产物查询失败：{resourceError}</div> : null}
        {!loading && !resourceError ? <DeployResourceList pages={pages} onCopy={onCopy} onOpen={onOpen} /> : null}
      </div>
    </div>
  );
}
