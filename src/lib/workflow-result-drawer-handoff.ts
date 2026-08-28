export interface WorkflowResultDrawerHandoffRequest {
  runId: string;
  complete: () => void;
}

type WorkflowResultDrawerHandoffListener = (
  request: WorkflowResultDrawerHandoffRequest,
) => boolean;

const listeners = new Set<WorkflowResultDrawerHandoffListener>();

export function subscribeWorkflowResultDrawerHandoff(
  listener: WorkflowResultDrawerHandoffListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function requestWorkflowResultDrawerHandoff(
  runId: string,
  openResult: () => void,
): boolean {
  let completed = false;
  const complete = () => {
    if (completed) return;
    completed = true;
    openResult();
  };

  for (const listener of listeners) {
    if (listener({ runId, complete })) return true;
  }

  complete();
  return false;
}
