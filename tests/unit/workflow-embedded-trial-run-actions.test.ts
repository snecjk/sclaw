import { describe, expect, it, vi } from 'vitest';

import { createEmbeddedTrialRunDrawerActions } from '@/pages/Workflow/workflow-embedded-trial-run-actions';

describe('createEmbeddedTrialRunDrawerActions', () => {
  it('closes only the drawer without ending the current bridge attempt', () => {
    const closeDrawer = vi.fn();
    const startNewRun = vi.fn();
    const actions = createEmbeddedTrialRunDrawerActions({ closeDrawer, startNewRun });

    actions.close();

    expect(closeDrawer).toHaveBeenCalledOnce();
    expect(startNewRun).not.toHaveBeenCalled();
  });

  it('uses a fresh-run action for both cancelled continue and rerun', () => {
    const startNewRun = vi.fn();
    const actions = createEmbeddedTrialRunDrawerActions({ closeDrawer: vi.fn(), startNewRun });

    actions.continueRun();
    actions.rerun();

    expect(startNewRun).toHaveBeenCalledTimes(2);
  });
});
