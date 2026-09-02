import { useEffect, useState } from 'react';
import { invokeIpc } from '@/lib/api-client';

export function useAppDevIdeOwnership(workspaceId: string): { open: boolean; ready: boolean } {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!workspaceId) {
      setOpen(false);
      setReady(true);
      return;
    }
    let cancelled = false;
    setReady(false);
    void invokeIpc<boolean>('app-dev-ide:isOpen', workspaceId)
      .then((value) => {
        if (!cancelled) setOpen(value === true);
      })
      .catch(() => {
        if (!cancelled) setOpen(false);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    const unsubscribe = window.electron?.ipcRenderer.on('app-dev-ide:ownership', (...args: unknown[]) => {
      const payload = args[0] as { workspaceId?: string; open?: boolean } | undefined;
      if (payload?.workspaceId === workspaceId) setOpen(Boolean(payload.open));
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [workspaceId]);

  return { open, ready };
}

export async function openAppDevIdeWindow(workspaceId: string, title?: string): Promise<void> {
  await invokeIpc('app-dev-ide:open', { workspaceId, title });
}
