import { describe, expect, it } from 'vitest';
import {
  applyStoredSessionLabels,
  findSessionKeyByTitle,
  hasUsableSessionTitle,
  resolveSessionLabel,
  scrubCorruptedSessionLabels,
  shouldAutoDeriveSessionLabel,
} from '@/lib/session-label';

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

describe('resolveSessionLabel', () => {
  const t = ((key: string) => {
    if (key === 'common:sidebar.newChat') return '新对话';
    if (key === 'chat:sessionList.mainSessionTitle') return '主会话';
    return key;
  }) as never;

  it('uses agent displayName only for main session', () => {
    expect(resolveSessionLabel({
      key: 'agent:main:main',
      displayName: 'S Claw',
      sessionLabels: {},
      t,
    })).toBe('S Claw');
    expect(resolveSessionLabel({
      key: 'agent:main:session-1',
      displayName: 'S Claw',
      sessionLabels: {},
      t,
    })).toBe('新对话');
  });

  it('ignores corrupted subagent boilerplate labels in sessionLabels', () => {
    expect(resolveSessionLabel({
      key: 'agent:main:subagent:child-1',
      sessionLabels: { 'agent:main:subagent:child-1': '[Subagent Context] You are running as a…' },
      t,
    })).toBe('新对话');
  });

  it('ignores corrupted subagent boilerplate on session.label', () => {
    expect(resolveSessionLabel({
      key: 'agent:main:subagent:child-1',
      label: '[Subagent Context] You are running as a subagent',
      sessionLabels: {},
      t,
    })).toBe('新对话');
  });

  it('ignores placeholder gateway label until a derived title exists', () => {
    expect(resolveSessionLabel({
      key: 'agent:main:session-1',
      label: '新对话',
      sessionLabels: { 'agent:main:session-1': '帮我发送上海下周的天气' },
      t,
    })).toBe('帮我发送上海下周的天气');
    expect(resolveSessionLabel({
      key: 'agent:main:session-2',
      label: '新对话',
      sessionLabels: {},
      t,
    })).toBe('新对话');
  });

  it('ignores corrupted DingTalk marker in sessionLabels', () => {
    expect(resolveSessionLabel({
      key: 'agent:main:session-1',
      sessionLabels: { 'agent:main:session-1': '[STOCLAW:DINGTALK_RECIPIENTS:v1]' },
      label: '@赵志坚 今晚记得学习哦',
      t,
    })).toBe('@赵志坚 今晚记得学习哦');
  });
});

describe('session label corruption cleanup', () => {
  it('scrubCorruptedSessionLabels removes subagent boilerplate entries', () => {
    const input = {
      good: '全国排污水量是多少',
      bad: '[Subagent Context] You are running as a…',
    };
    expect(scrubCorruptedSessionLabels(input)).toEqual({ good: '全国排污水量是多少' });
  });

  it('scrubCorruptedSessionLabels removes DingTalk recipient marker titles', () => {
    const input = {
      good: '@赵志坚 今晚记得学习哦',
      bad: '[STOCLAW:DINGTALK_RECIPIENTS:v1]',
    };
    expect(scrubCorruptedSessionLabels(input)).toEqual({ good: '@赵志坚 今晚记得学习哦' });
  });

  it('scrubCorruptedSessionLabels removes placeholder titles', () => {
    const input = {
      good: '对申通快递进行每日分析',
      bad: '新对话',
    };
    expect(scrubCorruptedSessionLabels(input)).toEqual({ good: '对申通快递进行每日分析' });
  });

  it('applyStoredSessionLabels does not overwrite with corrupted stored labels', () => {
    const sessions = [{ key: 'agent:main:subagent:child-1', label: 'gateway title' }];
    const labels = { 'agent:main:subagent:child-1': '[Subagent Context] You are running as a…' };
    expect(applyStoredSessionLabels(sessions, labels)).toEqual(sessions);
  });

  it('hasUsableSessionTitle treats corrupted stored labels as missing', () => {
    const session = { key: 'agent:main:subagent:child-1', label: undefined, displayName: undefined };
    const labels = { 'agent:main:subagent:child-1': '[Subagent Context] You are running as a…' };
    expect(hasUsableSessionTitle(session, labels)).toBe(false);
  });

  it('hasUsableSessionTitle treats placeholder labels as missing', () => {
    expect(hasUsableSessionTitle(
      { key: 'agent:main:session-1', label: '新对话' },
      {},
    )).toBe(false);
    expect(hasUsableSessionTitle(
      { key: 'agent:main:session-1', label: '帮我查天气' },
      {},
    )).toBe(true);
  });

  it('hasUsableSessionTitle treats DingTalk marker labels as missing', () => {
    const session = { key: 'agent:main:session-1', label: undefined, displayName: undefined };
    const labels = { 'agent:main:session-1': '[STOCLAW:DINGTALK_RECIPIENTS:v1]' };
    expect(hasUsableSessionTitle(session, labels)).toBe(false);
  });
});

describe('session label persist helpers', () => {
  it('shouldAutoDeriveSessionLabel respects in-memory custom titles', () => {
    const corrupted = (label: string) => label.includes('<!--');
    expect(shouldAutoDeriveSessionLabel('agent:main:session-1', { 'agent:main:session-1': '执行工作流A' }, corrupted)).toBe(false);
    expect(shouldAutoDeriveSessionLabel('agent:main:session-1', {}, corrupted)).toBe(true);
    expect(shouldAutoDeriveSessionLabel('agent:main:session-1', { 'agent:main:session-1': '新对话' }, corrupted)).toBe(true);
  });
});
