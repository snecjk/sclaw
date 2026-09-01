import { describe, expect, it } from 'vitest';
import {
  findInProgressStoAppDeploy,
  historyRecordFromDeployFields,
  parseStoAppDeployHistoryFile,
  upsertStoAppDeployHistoryItems,
} from '../../shared/sto-app-deploy-history';

describe('sto app deploy history', () => {
  it('upserts by deploymentId and keeps newest first', () => {
    const first = {
      deploymentId: 'dep_1',
      status: 'SUCCESS',
      startedAt: 1,
      updatedAt: 1,
    };
    const second = {
      deploymentId: 'dep_2',
      status: 'BUILDING',
      startedAt: 2,
      updatedAt: 2,
    };
    const updatedFirst = {
      ...first,
      status: 'FAILED',
      updatedAt: 3,
    };
    const items = upsertStoAppDeployHistoryItems(
      upsertStoAppDeployHistoryItems([first], second),
      updatedFirst,
    );
    expect(items.map((item) => item.deploymentId)).toEqual(['dep_1', 'dep_2']);
    expect(items[0]?.status).toBe('FAILED');
  });

  it('finds an in-progress record for resume polling', () => {
    const items = parseStoAppDeployHistoryFile({
      version: 1,
      items: [
        { deploymentId: 'dep_ok', status: 'SUCCESS', startedAt: 1, updatedAt: 1 },
        { deploymentId: 'dep_busy', status: 'BUILDING', startedAt: 2, updatedAt: 2 },
      ],
    });
    expect(findInProgressStoAppDeploy(items)?.deploymentId).toBe('dep_busy');
  });

  it('does not persist a record without a real deploymentId', () => {
    expect(historyRecordFromDeployFields({ env: 'daily', status: 'CREATED' }, 1)).toBeNull();
    expect(historyRecordFromDeployFields({ deploymentId: 'dep_1', env: 'daily', status: 'CREATED' }, 1)).toMatchObject({
      deploymentId: 'dep_1',
      env: 'daily',
    });
  });
});
