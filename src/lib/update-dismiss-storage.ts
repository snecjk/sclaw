const DISMISS_KEY_PREFIX = 'sto-claw:update-dismissed:';

export function isUpdateDismissed(version: string): boolean {
  if (!version) return false;
  try {
    return localStorage.getItem(`${DISMISS_KEY_PREFIX}${version}`) === '1';
  } catch {
    return false;
  }
}

export function dismissUpdate(version: string): void {
  if (!version) return;
  try {
    localStorage.setItem(`${DISMISS_KEY_PREFIX}${version}`, '1');
  } catch {
    // ignore quota / private mode
  }
}
