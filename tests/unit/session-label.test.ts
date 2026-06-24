import { describe, expect, it } from 'vitest';
import { findSessionKeyByTitle } from '@/lib/session-label';

describe('findSessionKeyByTitle', () => {
  const sessions = [
    { key: 'agent:main:session-1', label: '周报' },
    { key: 'agent:main:session-2', label: '日报' },
    { key: 'agent:main:session-3', label: '周报' },
  ];

  it('matches label case-insensitively', () => {
    expect(findSessionKeyByTitle('周报', sessions, {})).toBe('agent:main:session-1');
    expect(findSessionKeyByTitle(' 日报 ', sessions, {})).toBe('agent:main:session-2');
  });

  it('prefers the most recently active session when titles collide', () => {
    const key = findSessionKeyByTitle('周报', sessions, {}, {
      'agent:main:session-1': 100,
      'agent:main:session-3': 200,
    });
    expect(key).toBe('agent:main:session-3');
  });

  it('matches local preview titles in sessionLabels', () => {
    expect(
      findSessionKeyByTitle('客户跟进', sessions, { 'agent:main:session-2': '客户跟进' }),
    ).toBe('agent:main:session-2');
  });

  it('returns undefined when nothing matches', () => {
    expect(findSessionKeyByTitle('不存在', sessions, {})).toBeUndefined();
    expect(findSessionKeyByTitle('', sessions, {})).toBeUndefined();
  });
});
