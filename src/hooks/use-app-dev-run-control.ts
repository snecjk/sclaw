import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';
import {
  getAppStatus,
  restartApp,
  startApp,
  stopApp,
  type AppDevStatus,
} from '@/lib/app-dev-api';
import { isSameAppDevStatus } from '@/lib/app-dev-status';
import { isAppDevRestartIntent } from '@/lib/app-dev-restart-intent';

interface UseAppDevRunControlOptions {
  workspaceId: string;
  setStatus: Dispatch<SetStateAction<AppDevStatus | null>>;
}

export function useAppDevRunControl({
  workspaceId,
  setStatus,
}: UseAppDevRunControlOptions) {
  const [previewRevision, setPreviewRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  const restoreStatusAfterError = useCallback(async () => {
    const next = await getAppStatus(workspaceId).catch(() => null);
    if (!next) return;
    setStatus((prev) => (isSameAppDevStatus(prev, next) ? prev : next));
  }, [setStatus, workspaceId]);

  const markStarting = useCallback(() => {
    setStatus((current) => current
      ? {
          ...current,
          phase: 'starting',
          progress: 0,
          previewUrl: undefined,
          error: undefined,
        }
      : current);
    // A new process may coincidentally receive the same port. The revision
    // guarantees that the preview frame is still recreated.
    setPreviewRevision((revision) => revision + 1);
  }, [setStatus]);

  const start = useCallback(async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    markStarting();
    try {
      await startApp(workspaceId);
      toast.success('正在启动预览');
    } catch (error) {
      await restoreStatusAfterError();
      toast.error(error instanceof Error ? error.message : '启动预览失败');
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, [markStarting, restoreStatusAfterError, workspaceId]);

  const stop = useCallback(async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setStatus((current) => current
      ? { ...current, phase: 'stopped', progress: 0, previewUrl: undefined, error: undefined }
      : current);
    try {
      await stopApp(workspaceId);
      toast.success('预览已停止');
    } catch (error) {
      await restoreStatusAfterError();
      toast.error(error instanceof Error ? error.message : '停止预览失败');
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, [restoreStatusAfterError, setStatus, workspaceId]);

  const restart = useCallback(async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    markStarting();
    try {
      await restartApp(workspaceId);
      toast.success('正在重新启动预览');
    } catch (error) {
      await restoreStatusAfterError();
      toast.error(error instanceof Error ? error.message : '重新启动预览失败');
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, [markStarting, restoreStatusAfterError, workspaceId]);

  const interceptRestartIntent = useCallback((text: string) => {
    if (!isAppDevRestartIntent(text)) return false;
    void restart();
    return true;
  }, [restart]);

  return {
    pending,
    previewRevision,
    start,
    stop,
    restart,
    interceptRestartIntent,
  };
}
