import { describe, expect, it } from 'vitest';
import {
  deployFieldsFromHistoryRecord,
  findInProgressStoAppDeploy,
  historyRecordFromDeployFields,
  parseStoAppDeployHistoryRecord,
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

  it('parses optional pipeline metadata while keeping old records compatible', () => {
    expect(parseStoAppDeployHistoryRecord({
      deploymentId: 'dep_1',
      startedAt: 1,
      updatedAt: 2,
      pipeline_instance_id: 5587,
      failure_stage: 'build',
      revision_id: 'rev_1',
    })).toMatchObject({
      pipelineInstanceId: '5587',
      failureStage: 'build',
      revisionId: 'rev_1',
    });
    expect(parseStoAppDeployHistoryRecord({
      deploymentId: 'dep_old',
      startedAt: 1,
      updatedAt: 2,
    })).toMatchObject({ deploymentId: 'dep_old', startedAt: 1, updatedAt: 2 });
  });

  it('round-trips optional pipeline metadata through deploy fields', () => {
    const record = historyRecordFromDeployFields({
      deploymentId: 'dep_1',
      pipelineInstanceId: '5587',
      failureStage: 'build',
      revisionId: 'rev_1',
    }, 1);
    expect(record).toMatchObject({
      pipelineInstanceId: '5587',
      failureStage: 'build',
      revisionId: 'rev_1',
    });
    expect(deployFieldsFromHistoryRecord(record!)).toMatchObject({
      pipelineInstanceId: '5587',
      failureStage: 'build',
      revisionId: 'rev_1',
    });
  });
});
