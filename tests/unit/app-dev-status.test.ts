import { describe, expect, it } from 'vitest';
import type { AppDevStatus } from '@/lib/app-dev-api';
import {
  APP_DEV_STATUS_POLL_MS_ACTIVE,
  APP_DEV_STATUS_POLL_MS_IDLE,
  APP_DEV_STATUS_POLL_MS_READY,
  appDevStatusPollIntervalMs,
  isSameAppDevStatus,
} from '@/lib/app-dev-status';

const ready: AppDevStatus = {
  workspaceId: 'ws-1',
  appPath: '/tmp/app',
  phase: 'ready',
  progress: 100,
  previewUrl: 'http://127.0.0.1:5173',
};

describe('isSameAppDevStatus', () => {
  it('treats cloned payloads with the same fields as equal', () => {
    expect(isSameAppDevStatus(ready, { ...ready })).toBe(true);
  });

  it('detects phase / url / error changes', () => {
    expect(isSameAppDevStatus(ready, { ...ready, phase: 'stopped' })).toBe(false);
    expect(isSameAppDevStatus(ready, { ...ready, previewUrl: 'http://127.0.0.1:5174' })).toBe(false);
    expect(isSameAppDevStatus(ready, { ...ready, error: 'boom' })).toBe(false);
  });

  it('handles null', () => {
    expect(isSameAppDevStatus(null, null)).toBe(true);
    expect(isSameAppDevStatus(ready, null)).toBe(false);
  });
});

describe('appDevStatusPollIntervalMs', () => {
  it('polls frequently while starting, then backs off once ready', () => {
    expect(appDevStatusPollIntervalMs('starting')).toBe(APP_DEV_STATUS_POLL_MS_ACTIVE);
    expect(appDevStatusPollIntervalMs('installing')).toBe(APP_DEV_STATUS_POLL_MS_ACTIVE);
    expect(appDevStatusPollIntervalMs('ready')).toBe(APP_DEV_STATUS_POLL_MS_READY);
    expect(appDevStatusPollIntervalMs('stopped')).toBe(APP_DEV_STATUS_POLL_MS_IDLE);
    expect(appDevStatusPollIntervalMs('error')).toBe(APP_DEV_STATUS_POLL_MS_IDLE);
  });
});
