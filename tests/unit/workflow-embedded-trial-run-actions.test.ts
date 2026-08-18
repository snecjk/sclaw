import { describe, expect, it, vi } from 'vitest';

import { createEmbeddedTrialRunDrawerActions } from '@/pages/Workflow/workflow-embedded-trial-run-actions';

describe('createEmbeddedTrialRunDrawerActions', () => {
  it('closes only the drawer without ending the current bridge attempt', () => {
    const closeDrawer = vi.fn();
    const continueRun = vi.fn();
    const rerun = vi.fn();
    const actions = createEmbeddedTrialRunDrawerActions({ closeDrawer, continueRun, rerun });

    actions.close();

    expect(closeDrawer).toHaveBeenCalledOnce();
    expect(continueRun).not.toHaveBeenCalled();
    expect(rerun).not.toHaveBeenCalled();
  });

  it('keeps cancelled continue and fresh rerun as separate actions', () => {
    const continueRun = vi.fn();
    const rerun = vi.fn();
    const actions = createEmbeddedTrialRunDrawerActions({
      closeDrawer: vi.fn(),
      continueRun,
      rerun,
    });

    actions.continueRun();
    expect(continueRun).toHaveBeenCalledOnce();
    expect(rerun).not.toHaveBeenCalled();

    actions.rerun();
    expect(rerun).toHaveBeenCalledOnce();
  });
});
