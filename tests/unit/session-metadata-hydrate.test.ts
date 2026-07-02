import { describe, expect, it } from 'vitest';
import {
  collectSessionsNeedingLabelHydrate,
  deriveStoredSessionLabelFromMessages,
  prepareMessagesForSessionLabelDerivation,
  SESSION_METADATA_HISTORY_LIMIT,
} from '@/stores/chat/session-metadata-hydrate';
import { CHAT_HISTORY_LENGTH_MAX_LIMIT } from '../../shared/chat-config';

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

  it('prioritizes sidebar recent order over activity', () => {
    const sessions = [
      { key: 'agent:main:session-a', label: '新对话', updatedAt: 500 },
      { key: 'agent:main:session-b', label: '新对话', updatedAt: 100 },
      { key: 'agent:main:session-c', label: '新对话', updatedAt: 300 },
    ];
    const ordered = collectSessionsNeedingLabelHydrate(
      sessions,
      {},
      {},
      ['agent:main:session-c', 'agent:main:session-a', 'agent:main:session-b'],
    );
    expect(ordered.map((s) => s.key)).toEqual([
      'agent:main:session-c',
      'agent:main:session-a',
      'agent:main:session-b',
    ]);
  });
});

describe('SESSION_METADATA_HISTORY_LIMIT', () => {
  it('matches loadHistory max cap so long sessions reach the first user turn', () => {
    expect(SESSION_METADATA_HISTORY_LIMIT).toBe(CHAT_HISTORY_LENGTH_MAX_LIMIT);
  });
});

describe('prepareMessagesForSessionLabelDerivation', () => {
  it('drops tool_result rows before title derivation', () => {
    const filtered = prepareMessagesForSessionLabelDerivation([
      { role: 'tool_result', content: 'ignored' },
      { role: 'user', content: '对申通快递(002468.SZ)进行每日分析' },
    ]);
    expect(filtered).toEqual([
      { role: 'user', content: '对申通快递(002468.SZ)进行每日分析' },
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
