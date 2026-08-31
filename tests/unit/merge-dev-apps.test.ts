import { describe, expect, it } from 'vitest';
import { mergeAndDedupeDevApps } from '../../electron/services/app-dev-service';
import type { DevAppSummary } from '../../src/lib/app-dev-api';

function cloudApp(overrides: Partial<DevAppSummary> = {}): DevAppSummary {
  return {
    workspaceId: '',
    name: '云端应用',
    appPath: '',
    projectType: 'frontend',
    createdAt: '2026-08-31T12:00:00.000Z',
    localReady: false,
    availability: 'remote-only',
    appCode: 'app_cloud',
    pageType: 'site',
    ...overrides,
  };
}

function localApp(overrides: Partial<DevAppSummary> = {}): DevAppSummary {
  return {
    workspaceId: 'ws-local',
    name: '云端应用',
    appPath: '/tmp/local-app',
    projectType: 'frontend',
    createdAt: '2026-08-31T11:00:00.000Z',
    localReady: true,
    availability: 'local',
    pageType: 'site',
    ...overrides,
  };
}

describe('mergeAndDedupeDevApps', () => {
  it('merges remote-only cloud row with matching local-only app by name', () => {
    const merged = mergeAndDedupeDevApps(
      [cloudApp()],
      [localApp()],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      appCode: 'app_cloud',
      workspaceId: 'ws-local',
      appPath: '/tmp/local-app',
      localReady: true,
      availability: 'local',
    });
  });

  it('dedupes duplicate cloud appCode rows preferring local-ready', () => {
    const merged = mergeAndDedupeDevApps(
      [
        cloudApp({ localReady: false, workspaceId: '' }),
        cloudApp({
          localReady: true,
          workspaceId: 'ws-bound',
          appPath: '/tmp/bound',
          availability: 'local',
        }),
      ],
      [],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].workspaceId).toBe('ws-bound');
    expect(merged[0].localReady).toBe(true);
  });

  it('keeps unmatched local-only apps', () => {
    const merged = mergeAndDedupeDevApps(
      [],
      [localApp({ name: '仅本地' })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('仅本地');
    expect(merged[0].appCode).toBeUndefined();
  });
});
