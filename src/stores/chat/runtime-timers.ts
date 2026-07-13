let historyPollTimer: ReturnType<typeof setTimeout> | null = null;
let errorRecoveryTimer: ReturnType<typeof setTimeout> | null = null;

export function setHistoryPollTimer(timer: ReturnType<typeof setTimeout> | null): void {
  historyPollTimer = timer;
}

export function clearHistoryPoll(): void {
  if (historyPollTimer) {
    clearTimeout(historyPollTimer);
    historyPollTimer = null;
  }
}

export function setErrorRecoveryTimer(timer: ReturnType<typeof setTimeout> | null): void {
  errorRecoveryTimer = timer;
}

export function hasErrorRecoveryTimer(): boolean {
  return errorRecoveryTimer != null;
}

export function clearErrorRecoveryTimer(): void {
  if (errorRecoveryTimer) {
    clearTimeout(errorRecoveryTimer);
    errorRecoveryTimer = null;
  }
}
