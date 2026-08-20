import { describe, expect, it, vi } from 'vitest';

import {
  requestWorkflowResultDrawerHandoff,
  subscribeWorkflowResultDrawerHandoff,
} from '@/lib/workflow-result-drawer-handoff';

describe('workflow result drawer handoff', () => {
  it('waits for the claiming listener and opens exactly once', () => {
    const openResult = vi.fn();
    let complete: (() => void) | undefined;
    const unsubscribe = subscribeWorkflowResultDrawerHandoff((request) => {
      if (request.runId !== 'run-1') return false;
      complete = request.complete;
      return true;
    });

    expect(requestWorkflowResultDrawerHandoff('run-1', openResult)).toBe(true);
    expect(openResult).not.toHaveBeenCalled();

    complete?.();
    complete?.();

    expect(openResult).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('opens immediately when no listener claims the run', () => {
    const openResult = vi.fn();

    expect(requestWorkflowResultDrawerHandoff('run-other', openResult)).toBe(false);
    expect(openResult).toHaveBeenCalledTimes(1);
  });

  it('does not invoke a listener after it unsubscribes', () => {
    const listener = vi.fn(() => true);
    const unsubscribe = subscribeWorkflowResultDrawerHandoff(listener);
    unsubscribe();

    const openResult = vi.fn();
    expect(requestWorkflowResultDrawerHandoff('run-1', openResult)).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(openResult).toHaveBeenCalledTimes(1);
  });
});
