import type { AppDevPhase, AppDevStatus } from '@/lib/app-dev-api';

/** Starting / installing: keep the progress bar moving. Ready: only watch for crashes. */
export const APP_DEV_STATUS_POLL_MS_ACTIVE = 1_500;
export const APP_DEV_STATUS_POLL_MS_READY = 8_000;
export const APP_DEV_STATUS_POLL_MS_IDLE = 4_000;

export function isSameAppDevStatus(
  left: AppDevStatus | null | undefined,
  right: AppDevStatus | null | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.workspaceId === right.workspaceId
    && left.appPath === right.appPath
    && left.phase === right.phase
    && left.progress === right.progress
    && left.previewUrl === right.previewUrl
    && left.error === right.error;
}

export function appDevStatusPollIntervalMs(phase: AppDevPhase | undefined): number {
  if (phase === 'ready') return APP_DEV_STATUS_POLL_MS_READY;
  if (phase === 'stopped' || phase === 'error') return APP_DEV_STATUS_POLL_MS_IDLE;
  return APP_DEV_STATUS_POLL_MS_ACTIVE;
}
