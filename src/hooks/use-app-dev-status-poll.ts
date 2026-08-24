import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { getAppStatus, startApp, type AppDevStatus } from '@/lib/app-dev-api';
import { appDevStatusPollIntervalMs, isSameAppDevStatus } from '@/lib/app-dev-status';

/**
 * Poll app-dev runtime status without forcing a React re-render when nothing
 * changed. Interval drops after the preview is ready (the previous 1.5s timer
 * kept re-rendering the whole workbench, including chat + webview).
 */
export function useAppDevStatusPoll(
  workspaceId: string,
  setStatus: Dispatch<SetStateAction<AppDevStatus | null>>,
  enabled = true,
): void {
  const startedOnceRef = useRef(false);

  useEffect(() => {
    startedOnceRef.current = false;
  }, [workspaceId]);

  useEffect(() => {
    if (!enabled || !workspaceId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      const next = await getAppStatus(workspaceId).catch(() => null);
      if (cancelled) return;
      if ((!next || next.phase === 'stopped') && !startedOnceRef.current) {
        startedOnceRef.current = true;
        void startApp(workspaceId).catch(() => undefined);
      } else if (next && next.phase !== 'stopped') {
        startedOnceRef.current = true;
      }
      if (next) {
        setStatus((prev) => (isSameAppDevStatus(prev, next) ? prev : next));
      }
      timer = setTimeout(() => void tick(), appDevStatusPollIntervalMs(next?.phase));
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, setStatus, workspaceId]);
}
