interface WorkflowIframeRequestManagerOptions {
  timeoutMs: number;
  timeoutMessage?: string;
  disposeMessage?: string;
  concurrentMessage?: string;
}

interface PendingRequest<T> {
  requestId: string;
  promise: Promise<T>;
  resolve: (snapshot: T) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface WorkflowIframeRequestManager<T> {
  begin: (requestId: string) => Promise<T>;
  resolve: (requestId: string, snapshot: T) => boolean;
  reject: (requestId: string, error: Error) => boolean;
  dispose: () => void;
}

export function createWorkflowIframeRequestManager<T>({
  timeoutMs,
  timeoutMessage = '未能保存当前画布草稿，请稍后重试',
  disposeMessage = '画布会话已重置，无法保存草稿',
  concurrentMessage = '正在保存当前画布草稿，请稍后重试',
}: WorkflowIframeRequestManagerOptions): WorkflowIframeRequestManager<T> {
  let pending: PendingRequest<T> | null = null;
  const terminalPromises = new Map<string, Promise<T>>();
  let disposed = false;

  const clearPending = () => {
    if (!pending) return null;
    const current = pending;
    clearTimeout(current.timer);
    pending = null;
    return current;
  };

  return {
    begin(requestId) {
      if (disposed) {
        return Promise.reject(new Error(disposeMessage));
      }
      const terminalPromise = terminalPromises.get(requestId);
      if (terminalPromise) return terminalPromise;
      if (pending) {
        if (pending.requestId === requestId) return pending.promise;
        return Promise.reject(new Error(concurrentMessage));
      }

      let resolveRequest!: (snapshot: T) => void;
      let rejectRequest!: (error: Error) => void;
      const promise = new Promise<T>((resolve, reject) => {
        resolveRequest = resolve;
        rejectRequest = reject;
      });
      const timer = setTimeout(() => {
        if (pending?.requestId !== requestId) return;
        terminalPromises.set(requestId, promise);
        pending = null;
        rejectRequest(new Error(timeoutMessage));
      }, timeoutMs);
      pending = {
        requestId,
        promise,
        resolve: resolveRequest,
        reject: rejectRequest,
        timer,
      };
      return promise;
    },

    resolve(requestId, snapshot) {
      if (disposed || pending?.requestId !== requestId) return false;
      const current = clearPending();
      if (current) terminalPromises.set(requestId, current.promise);
      current?.resolve(snapshot);
      return true;
    },

    reject(requestId, error) {
      if (disposed || pending?.requestId !== requestId) return false;
      const current = clearPending();
      if (current) terminalPromises.set(requestId, current.promise);
      current?.reject(error);
      return true;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      const current = clearPending();
      if (current) terminalPromises.set(current.requestId, current.promise);
      current?.reject(new Error(disposeMessage));
    },
  };
}
