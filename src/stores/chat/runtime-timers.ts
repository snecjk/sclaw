type Timer = ReturnType<typeof setTimeout>;

const historyPollTimers = new Map<string, Timer>();
const errorRecoveryTimers = new Map<string, Timer>();
const stuckCheckTimers = new Map<string, Timer>();

function replaceTimer(registry: Map<string, Timer>, sessionKey: string, timer: Timer | null): void {
  const previous = registry.get(sessionKey);
  if (previous && previous !== timer) clearTimeout(previous);
  if (timer) registry.set(sessionKey, timer);
  else registry.delete(sessionKey);
}

function clearTimer(registry: Map<string, Timer>, sessionKey: string): void {
  const timer = registry.get(sessionKey);
  if (timer) clearTimeout(timer);
  registry.delete(sessionKey);
}

export function setHistoryPollTimer(sessionKey: string, timer: Timer | null): void {
  replaceTimer(historyPollTimers, sessionKey, timer);
}

export function clearHistoryPoll(sessionKey: string): void {
  clearTimer(historyPollTimers, sessionKey);
}

export function setErrorRecoveryTimer(sessionKey: string, timer: Timer | null): void {
  replaceTimer(errorRecoveryTimers, sessionKey, timer);
}

export function hasErrorRecoveryTimer(sessionKey: string): boolean {
  return errorRecoveryTimers.has(sessionKey);
}

export function clearErrorRecoveryTimer(sessionKey: string): void {
  clearTimer(errorRecoveryTimers, sessionKey);
}

export function setStuckCheckTimer(sessionKey: string, timer: Timer | null): void {
  replaceTimer(stuckCheckTimers, sessionKey, timer);
}

export function clearStuckCheckTimer(sessionKey: string): void {
  clearTimer(stuckCheckTimers, sessionKey);
}

export function clearSessionRuntimeTimers(sessionKey: string): void {
  clearHistoryPoll(sessionKey);
  clearErrorRecoveryTimer(sessionKey);
  clearStuckCheckTimer(sessionKey);
}
