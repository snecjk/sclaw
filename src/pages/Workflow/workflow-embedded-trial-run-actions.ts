interface EmbeddedTrialRunDrawerActionOptions {
  closeDrawer: () => void;
  startNewRun: () => void | Promise<void>;
}

export function createEmbeddedTrialRunDrawerActions({
  closeDrawer,
  startNewRun,
}: EmbeddedTrialRunDrawerActionOptions) {
  return {
    close: closeDrawer,
    continueRun: startNewRun,
    rerun: startNewRun,
  };
}
