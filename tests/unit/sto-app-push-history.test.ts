import { describe, expect, it } from 'vitest';
import {
  parseStoAppPushHistoryFile,
  stoAppPushToCheckpoint,
  upsertStoAppPushHistoryItems,
} from '../../shared/sto-app-push-history';

describe('sto app push history', () => {
  it('upserts by revisionId and keeps newest first', () => {
    const first = {
      revisionId: 'rev_1',
      appCode: 'app_1',
      message: '第一次',
      createdAt: 1,
    };
    const second = {
      revisionId: 'rev_2',
      appCode: 'app_1',
      message: '第二次',
      commitSha: 'abc123',
      createdAt: 2,
    };
    const items = upsertStoAppPushHistoryItems(
      upsertStoAppPushHistoryItems([], first),
      second,
    );
    expect(items.map((item) => item.revisionId)).toEqual(['rev_2', 'rev_1']);
  });

  it('reads snake_case CLI fields', () => {
    expect(parseStoAppPushHistoryFile({
      version: 1,
      items: [{
        revision_id: 'rev_1',
        app_code: 'app_1',
        revision_message: '更新应用',
        commit_sha: 'deadbeef',
        createdAt: 10,
      }],
    })).toEqual([{
      revisionId: 'rev_1',
      appCode: 'app_1',
      message: '更新应用',
      commitSha: 'deadbeef',
      createdAt: 10,
    }]);
  });

  it('maps a push record onto the 最近提交 row shape', () => {
    expect(stoAppPushToCheckpoint({
      revisionId: 'rev_long',
      appCode: 'app_1',
      message: '发布前同步',
      commitSha: '13f8e83f399b5d0e',
      createdAt: 99,
    })).toEqual({
      hash: '13f8e83f399b5d0e',
      subject: '发布前同步',
      timestamp: 99,
    });
  });
});
