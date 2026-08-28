import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  applyAppTemplateImport,
  cancelAppTemplateImport,
  getAppTemplateImportStatus,
  prepareAppTemplateImport,
} from '@/lib/app-dev-api';
import { pickProjectFolder } from '@/lib/session-catalog-api';
import type {
  TemplateImportApplyResult,
  TemplateImportPreview,
  TemplateImportStatus,
} from '../../../shared/app-template-source-import';
import { TemplateProjectUploadDialog } from './TemplateProjectUploadDialog';

type UploadState =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'review'; preview: TemplateImportPreview }
  | { kind: 'applying'; preview: TemplateImportPreview };

export function TemplateProjectUploadControl({
  workspaceId,
  onApplied,
}: {
  workspaceId: string;
  onApplied: (result: TemplateImportApplyResult) => void;
}) {
  const [status, setStatus] = useState<TemplateImportStatus | null>(null);
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const activeSessionRef = useRef<{ workspaceId: string; importToken: string } | null>(null);

  const refreshStatus = useCallback(async () => {
    const next = await getAppTemplateImportStatus(workspaceId);
    setStatus(next);
    return next;
  }, [workspaceId]);

  useEffect(() => {
    let disposed = false;
    void getAppTemplateImportStatus(workspaceId)
      .then((next) => { if (!disposed) setStatus(next); })
      .catch(() => { if (!disposed) setStatus({ hasSource: false, sourceAvailable: false }); });
    return () => {
      disposed = true;
      const active = activeSessionRef.current;
      activeSessionRef.current = null;
      if (active) void cancelAppTemplateImport(active).catch(() => undefined);
    };
  }, [workspaceId]);

  const prepare = useCallback(async (sourcePath?: string) => {
    setState({ kind: 'preparing' });
    try {
      const preview = await prepareAppTemplateImport({
        workspaceId,
        ...(sourcePath ? { sourcePath } : {}),
      });
      activeSessionRef.current = { workspaceId, importToken: preview.importToken };
      setState({ kind: 'review', preview });
    } catch (error) {
      setState({ kind: 'idle' });
      toast.error(error instanceof Error ? error.message : '项目扫描失败');
    }
  }, [workspaceId]);

  const pickAndPrepare = useCallback(async () => {
    const sourcePath = await pickProjectFolder();
    if (sourcePath) await prepare(sourcePath);
  }, [prepare]);

  const start = useCallback(async () => {
    if (status?.hasSource && status.sourceAvailable) await prepare();
    else await pickAndPrepare();
  }, [pickAndPrepare, prepare, status]);

  const cancelActive = useCallback(async () => {
    const active = activeSessionRef.current;
    activeSessionRef.current = null;
    setState({ kind: 'idle' });
    if (active) await cancelAppTemplateImport(active).catch(() => undefined);
  }, []);

  const pickAnother = useCallback(async () => {
    await cancelActive();
    await pickAndPrepare();
  }, [cancelActive, pickAndPrepare]);

  const apply = useCallback(async (preview: TemplateImportPreview) => {
    setState({ kind: 'applying', preview });
    try {
      const result = await applyAppTemplateImport({
        workspaceId,
        importToken: preview.importToken,
      });
      activeSessionRef.current = null;
      setState({ kind: 'idle' });
      await refreshStatus().catch(() => undefined);
      toast.success(`已上传 ${result.changedFiles.length} 个变更文件`);
      onApplied(result);
    } catch (error) {
      activeSessionRef.current = null;
      setState({ kind: 'idle' });
      toast.error(error instanceof Error ? error.message : '项目上传失败');
    }
  }, [onApplied, refreshStatus, workspaceId]);

  const busy = state.kind === 'preparing' || state.kind === 'applying';
  const preview = state.kind === 'review' || state.kind === 'applying' ? state.preview : null;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs"
        disabled={busy}
        onClick={() => void start()}
      >
        {state.kind === 'preparing'
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          : <FolderUp className="h-3.5 w-3.5" aria-hidden />}
        {state.kind === 'preparing'
          ? '扫描中…'
          : status?.hasSource
            ? '重新上传'
            : '上传项目'}
      </Button>
      {preview ? (
        <TemplateProjectUploadDialog
          open
          preview={preview}
          applying={state.kind === 'applying'}
          onApply={() => apply(preview)}
          onCancel={() => void cancelActive()}
          onPickAnother={() => void pickAnother()}
        />
      ) : null}
    </>
  );
}
