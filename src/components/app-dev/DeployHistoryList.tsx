import { cn } from '@/lib/utils';
import { codeDeployStatusLabel } from '../../../shared/code-deploy-status';
import type { StoAppDeployHistoryRecord } from '../../../shared/sto-app-deploy-history';

const ENV_LABELS: Record<string, string> = { daily: '测试', stage: '预发', online: '生产' };

export function DeployHistoryList({ records, selectedId, onSelect }: {
  records: StoAppDeployHistoryRecord[];
  selectedId?: string;
  onSelect: (record: StoAppDeployHistoryRecord) => void;
}) {
  if (records.length === 0) return <div className="p-6 text-center text-sm text-muted-foreground">暂无发布记录</div>;
  return (
    <div className="space-y-1 p-2">
      {records.map((record) => (
        <button
          key={record.deploymentId}
          type="button"
          className={cn(
            'w-full cursor-pointer rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            selectedId === record.deploymentId ? 'border-primary/40 bg-primary/10' : 'border-transparent hover:bg-muted/60',
          )}
          onClick={() => onSelect(record)}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium">{ENV_LABELS[record.env ?? ''] ?? record.env ?? '未知环境'}</span>
            <span className="text-[11px] text-muted-foreground">{codeDeployStatusLabel(record.status)}</span>
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{record.deploymentId}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">{new Date(record.updatedAt).toLocaleString()}</div>
        </button>
      ))}
    </div>
  );
}
