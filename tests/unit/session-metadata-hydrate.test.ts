import { describe, expect, it } from 'vitest';
import {
  collectSessionsNeedingLabelHydrate,
  deriveStoredSessionLabelFromMessages,
} from '@/stores/chat/session-metadata-hydrate';

describe('collectSessionsNeedingLabelHydrate', () => {
  it('includes placeholder-label sessions and prioritizes them', () => {
    const sessions = [
      { key: 'agent:main:session-1', label: '真实标题', updatedAt: 100 },
      { key: 'agent:main:session-2', label: '新对话', updatedAt: 200 },
      { key: 'agent:main:session-3', label: '新对话', updatedAt: 50 },
    ];
    const ordered = collectSessionsNeedingLabelHydrate(sessions, {}, {});
    expect(ordered.map((s) => s.key)).toEqual([
      'agent:main:session-2',
      'agent:main:session-3',
    ]);
  });
});

describe('deriveStoredSessionLabelFromMessages', () => {
  it('derives title from first user message', () => {
    const label = deriveStoredSessionLabelFromMessages(
      'agent:main:session-1',
      [{ key: 'agent:main:session-1', label: '新对话' }],
      {},
      [{ role: 'user', content: '帮我生成一个汇报的金融类数据报表HTML' }],
    );
    expect(label).toBe('帮我生成一个汇报的金融类数据报表HTML');
  });
});
