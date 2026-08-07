import { beforeEach, describe, expect, it } from 'vitest';
import {
  checkDwsSendDedup,
  recordDwsSent,
  resetDwsSendDedupForTests,
} from '../../electron/utils/dws-send-dedup';

describe('dws-send-dedup content hash', () => {
  beforeEach(() => resetDwsSendDedupForTests());

  it('records and hits same recipient+text within TTL', () => {
    recordDwsSent('user:u1', 'hello');
    expect(checkDwsSendDedup('user:u1', 'hello').recent).toBe(true);
    expect(checkDwsSendDedup('user:u1', 'other').recent).toBe(false);
  });
});
