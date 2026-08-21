interface EmbeddedTrialRunDrawerActionOptions {
  closeDrawer: () => void;
  continueRun: () => void | Promise<void>;
  rerun: () => void | Promise<void>;
}

export function createEmbeddedTrialRunDrawerActions({
  closeDrawer,
  continueRun,
  rerun,
}: EmbeddedTrialRunDrawerActionOptions) {
  return {
    close: closeDrawer,
    continueRun,
    rerun,
  };
}
