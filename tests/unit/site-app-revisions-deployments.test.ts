import { describe, expect, it } from 'vitest';
import {
  parseSiteAppSourceRevision,
  parseSiteAppSourceRevisions,
  siteAppRevisionToCheckpoint,
} from '../../shared/site-app-source-revisions';
import {
  parseSiteAppDeploymentList,
  parseSiteAppDeployRollbackResult,
} from '../../shared/site-app-deployments';

describe('site-app-source-revisions', () => {
  it('parses revision list payload', () => {
    const items = parseSiteAppSourceRevisions({
      data: [{
        revision_id: 'rev1',
        commit_sha: 'abc12345',
        revision_message: '改 Banner',
        created_by_name: '张三',
        created_at: '2026-09-15T01:00:00.000Z',
      }],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.revisionId).toBe('rev1');
    expect(siteAppRevisionToCheckpoint(items[0]!).subject).toContain('张三');
  });

  it('returns null without revision id', () => {
    expect(parseSiteAppSourceRevision({ commit_sha: 'abc' })).toBeNull();
  });
});

describe('site-app-deployments', () => {
  it('parses deployment list and rollback result', () => {
    const list = parseSiteAppDeploymentList({
      data: [{
        id: 10342,
        iterate_name: 'v1.0',
        is_online: true,
        available: true,
        create_time: 1789099200000,
      }],
    });
    expect(list[0]).toMatchObject({
      id: 10342,
      iterateName: 'v1.0',
      isOnline: true,
    });

    const rollback = parseSiteAppDeployRollbackResult({
      success: true,
      data: {
        status: 'success',
        message: '目标版本已在线',
        target_record_id: 10342,
        records: list,
      },
    });
    expect(rollback.status).toBe('success');
    expect(rollback.records).toHaveLength(1);
  });
});
