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

  it('collapses two cloud apps bound to the same local workspace into one card', () => {
    const merged = mergeAndDedupeDevApps(
      [
        cloudApp({
          appCode: 'app_new',
          name: '测试建站链路 0831002',
          localReady: true,
          availability: 'local',
          workspaceId: 'ws-shared',
          appPath: '/tmp/shared-app',
          createdAt: '2026-08-31T14:37:00.000Z',
        }),
        cloudApp({
          appCode: 'app_old',
          name: '测试建站链路 0831002',
          localReady: true,
          availability: 'local',
          workspaceId: 'ws-shared',
          appPath: '/tmp/shared-app',
          createdAt: '2026-08-31T14:30:00.000Z',
        }),
      ],
      [],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].appCode).toBe('app_new');
    expect(merged[0].workspaceId).toBe('ws-shared');
    expect(merged[0].localReady).toBe(true);
  });

  it('aligns leftover cloud create with the local project after first publish', () => {
    const merged = mergeAndDedupeDevApps(
      [
        cloudApp({
          appCode: 'app_5e8ef0d2752b3ad3',
          name: '测试建站链路 0831002',
          localReady: true,
          availability: 'local',
          workspaceId: 'ws-shared',
          appPath: '/tmp/shared-app',
        }),
        cloudApp({
          appCode: 'app_cb1bddf371e19a70',
          name: '测试建站链路 0831002',
          localReady: false,
          availability: 'remote-only',
          workspaceId: '',
          appPath: '',
        }),
      ],
      [],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      appCode: 'app_5e8ef0d2752b3ad3',
      workspaceId: 'ws-shared',
      localReady: true,
      availability: 'local',
    });
  });
});
