import { useState, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';
import {
  getAppStatus,
  restartApp,
  startApp,
  stopApp,
  type AppDevStatus,
} from '@/lib/app-dev-api';
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

  const restoreStatusAfterError = async () => {
    const next = await getAppStatus(workspaceId).catch(() => null);
    if (next) setStatus(next);
  };

  const markStarting = () => {
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
  };

  const start = async () => {
    if (pending) return;
    setPending(true);
    markStarting();
    try {
      await startApp(workspaceId);
      toast.success('正在启动预览');
    } catch (error) {
      await restoreStatusAfterError();
      toast.error(error instanceof Error ? error.message : '启动预览失败');
    } finally {
      setPending(false);
    }
  };

  const stop = async () => {
    if (pending) return;
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
      setPending(false);
    }
  };

  const restart = async () => {
    if (pending) return;
    setPending(true);
    markStarting();
    try {
      await restartApp(workspaceId);
      toast.success('正在重新启动预览');
    } catch (error) {
      await restoreStatusAfterError();
      toast.error(error instanceof Error ? error.message : '重新启动预览失败');
    } finally {
      setPending(false);
    }
  };

  const interceptRestartIntent = (text: string) => {
    if (!isAppDevRestartIntent(text)) return false;
    void restart();
    return true;
  };

  return {
    pending,
    previewRevision,
    start,
    stop,
    restart,
    interceptRestartIntent,
  };
}
