import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getStoAppDeployResources, refreshStoAppDeploy } from '@/lib/app-dev-api';
import { openExternalUrl } from '@/lib/preview-url';
import { isCodeDeploySuccess, pickCodeDeployFields, type CodeDeployRecordFields } from '../../../shared/code-deploy-status';
import { flattenDeployResourcePages, parseDeployResourceRecords, type DeployResourcePage } from '../../../shared/sto-app-deploy-resources';
import type { StoAppDeployHistoryRecord } from '../../../shared/sto-app-deploy-history';
import { DeployHistoryList } from './DeployHistoryList';
import { DeployRecordDetail } from './DeployRecordDetail';

export function StoAppDeployHistoryDialog({ open, workspaceId, appCode, history, initialDeploymentId, onOpenChange }: {
  open: boolean;
  workspaceId: string;
  appCode?: string;
  history: StoAppDeployHistoryRecord[];
  initialDeploymentId?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const [fields, setFields] = useState<CodeDeployRecordFields | null>(null);
  const [pages, setPages] = useState<DeployResourcePage[]>([]);
  const [loading, setLoading] = useState(false);
  const [resourceError, setResourceError] = useState<string>();
  const requestIdRef = useRef(0);
  const records = useMemo(() => [...history].sort((a, b) => b.updatedAt - a.updatedAt), [history]);
  const effectiveSelectedId = records.some((record) => record.deploymentId === selectedId)
    ? selectedId
    : (records.find((record) => record.deploymentId === initialDeploymentId) ?? records[0])?.deploymentId;
  const selected = records.find((record) => record.deploymentId === effectiveSelectedId) ?? null;

  const load = useCallback(async (record: StoAppDeployHistoryRecord) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setResourceError(undefined);
    setPages([]);
    try {
      const refreshed = await refreshStoAppDeploy({ workspaceId, appCode: record.appCode ?? appCode, deploymentId: record.deploymentId });
      if (requestId !== requestIdRef.current) return;
      const nextFields = pickCodeDeployFields(refreshed.data);
      setFields(nextFields);
      if (!isCodeDeploySuccess(nextFields.status)) return;
      const pipelineInstanceId = nextFields.pipelineInstanceId ?? record.pipelineInstanceId;
      if (!pipelineInstanceId) {
        setResourceError('发布记录中缺少流水线实例 ID');
        return;
      }
      try {
        const result = await getStoAppDeployResources({ workspaceId, appCode: nextFields.applicationId ?? record.appCode ?? appCode, pipelineInstanceId });
        if (requestId !== requestIdRef.current) return;
        setPages(flattenDeployResourcePages(parseDeployResourceRecords(result.data)));
      } catch (error) {
        if (requestId === requestIdRef.current) setResourceError(error instanceof Error ? error.message : '未知错误');
      }
    } catch (error) {
      if (requestId === requestIdRef.current) setResourceError(error instanceof Error ? error.message : '刷新发布状态失败');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [appCode, workspaceId]);

  useEffect(() => {
    if (!open) { requestIdRef.current += 1; return; }
    const next = records.find((record) => record.deploymentId === initialDeploymentId) ?? records[0];
    // Reset selection for each controlled dialog opening (including Git-row deep links).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedId(next?.deploymentId);
    if (next) void load(next);
  }, [initialDeploymentId, load, open, records]);

  const select = (record: StoAppDeployHistoryRecord) => {
    setSelectedId(record.deploymentId);
    setFields({ ...record, applicationId: record.appCode });
    void load(record);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-label="发布记录"
        overlayClassName="!z-[260]"
        className="!z-[260] h-[min(720px,85vh)] w-[calc(100vw-3rem)] max-w-[1040px] gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-base">发布记录</DialogTitle>
          <DialogDescription className="text-xs">查看本地发布历史、流水线状态与静态资源产物</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-rows-[180px_minmax(0,1fr)] md:grid-cols-[280px_minmax(0,1fr)] md:grid-rows-1">
          <aside className="min-h-0 overflow-y-auto border-b border-border bg-muted/20 md:border-b-0 md:border-r" aria-label="发布记录列表">
            <DeployHistoryList records={records} selectedId={effectiveSelectedId} onSelect={select} />
          </aside>
          <DeployRecordDetail record={selected} fields={fields} pages={pages} loading={loading} resourceError={resourceError} onRefresh={() => selected && void load(selected)} onCopy={(url) => void navigator.clipboard.writeText(url).then(() => toast.success('已复制')).catch(() => toast.error('复制失败'))} onOpen={openExternalUrl} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
