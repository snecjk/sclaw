import { describe, expect, it } from 'vitest';
import type { RawMessage } from '@/stores/chat/types';
import { WORKFLOW_SESSION_HINT_MARKER } from '@/lib/workflow-session-hint';
import {
  dedupeRedundantUserMessages,
  dropSyntheticSkillSessionLabelUsers,
  ensureOpeningUserMessageFirst,
  isSameUserMessage,
  mergeOptimisticUserIntoHistory,
  recoverInitialUserFromSessionLabel,
} from '@/stores/chat/user-message-merge';
import { restoreSkillMetaOnMessages } from '@/lib/skill-message-meta-cache';
import { appendSkillTranscriptMarker } from '@/lib/skill-transcript-marker';

describe('user-message-merge', () => {
  it('does not append optimistic user when history already has matching text', () => {
    const optimistic = {
      id: 'local-user-1',
      role: 'user',
      content: '你仔细看下',
      timestamp: 1710000000,
    } as RawMessage;
    const enriched = [
      {
        id: 'history-user-1',
        role: 'user',
        content: '你仔细看下',
        timestamp: 1700000000,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '连接模型中...',
        timestamp: 1710000001,
      },
    ] as RawMessage[];

    const merged = mergeOptimisticUserIntoHistory(enriched, [optimistic], {
      userMessageAt: 1710000000000,
      sending: true,
    });

    expect(merged.map((message) => message.content)).toEqual([
      '你仔细看下',
      '连接模型中...',
    ]);
  });

  it('inserts optimistic user before assistant when history has not caught up', () => {
    const optimistic = {
      id: 'local-user-1',
      role: 'user',
      content: '你仔细看下',
      timestamp: 1710000000,
    } as RawMessage;
    const enriched = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '连接模型中...',
        timestamp: 1710000003,
      },
    ] as RawMessage[];

    const merged = mergeOptimisticUserIntoHistory(enriched, [optimistic], {
      userMessageAt: 1710000000000,
      sending: true,
    });

    expect(merged.map((message) => message.content)).toEqual([
      '你仔细看下',
      '连接模型中...',
    ]);
  });

  it('uses cachedOptimistic when messages[] was cleared by switchSession', () => {
    const cachedOptimistic = {
      id: 'local-user-2',
      role: 'user',
      content: '切换会话后还在发送',
      timestamp: 1710000000,
    } as RawMessage;
    const enriched = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '连接模型中...',
        timestamp: 1710000003,
      },
    ] as RawMessage[];

    const merged = mergeOptimisticUserIntoHistory(enriched, [], {
      userMessageAt: 1710000000000,
      sending: true,
      cachedOptimistic,
    });

    expect(merged.map((message) => message.content)).toEqual([
      '切换会话后还在发送',
      '连接模型中...',
    ]);
  });

  it('removes consecutive duplicate user messages', () => {
    const messages = [
      { id: 'user-1', role: 'user', content: '你仔细看下', timestamp: 1710000000 },
      { id: 'user-2', role: 'user', content: '你仔细看下', timestamp: 1710000000 },
    ] as RawMessage[];

    const deduped = dedupeRedundantUserMessages(messages, 1710000000000);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.content).toBe('你仔细看下');
  });

  it('preserves non-adjacent identical-text user messages as distinct turns', () => {
    const messages = [
      { id: 'user-1', role: 'user', content: 'hello', timestamp: 1710000000 },
      { id: 'assistant-1', role: 'assistant', content: 'reply-1', timestamp: 1710000003 },
      { id: 'user-2', role: 'user', content: 'hello', timestamp: 1710000010 },
      { id: 'assistant-2', role: 'assistant', content: 'reply-2', timestamp: 1710000013 },
    ] as RawMessage[];

    const deduped = dedupeRedundantUserMessages(messages, 1710000010000);

    expect(deduped.map((message) => message.content)).toEqual([
      'hello', 'reply-1', 'hello', 'reply-2',
    ]);
  });

  it('drops a non-adjacent user duplicate only when ids match', () => {
    const messages = [
      { id: 'same-id', role: 'user', content: 'hello', timestamp: 1710000000 },
      { id: 'assistant-1', role: 'assistant', content: 'reply', timestamp: 1710000003 },
      { id: 'same-id', role: 'user', content: 'hello', timestamp: 1710000010 },
    ] as RawMessage[];

    const deduped = dedupeRedundantUserMessages(messages, null);

    expect(deduped.map((message) => message.content)).toEqual(['hello', 'reply']);
  });

  it('matches optimistic and gateway user when only gateway text has injected hints', () => {
    const optimistic = {
      id: 'local-user-1',
      role: 'user',
      content: '创建工作流测试',
      timestamp: 1710000000,
    } as RawMessage;
    const gatewayUserText = `${WORKFLOW_SESSION_HINT_MARKER}\n## hint\n${WORKFLOW_SESSION_HINT_MARKER}\n创建工作流测试`;
    const enriched = [
      {
        id: 'history-user-1',
        role: 'user',
        content: gatewayUserText,
        timestamp: 1710000030,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '好的',
        timestamp: 1710000031,
      },
    ] as RawMessage[];

    expect(isSameUserMessage(enriched[0], optimistic, 1710000000000)).toBe(true);

    const merged = mergeOptimisticUserIntoHistory(enriched, [optimistic], {
      userMessageAt: 1710000000000,
      sending: true,
    });

    expect(merged.filter((m) => m.role === 'user')).toHaveLength(1);
    expect(merged[0]?.id).toBe('history-user-1');
  });

  it('dedupes non-adjacent optimistic echo during active send', () => {
    const messages = [
      { id: 'local-user', role: 'user', content: 'hello', timestamp: 1710000000 },
      { id: 'assistant-1', role: 'assistant', content: 'reply', timestamp: 1710000003 },
      {
        id: 'history-user',
        role: 'user',
        content: `${WORKFLOW_SESSION_HINT_MARKER}\n${WORKFLOW_SESSION_HINT_MARKER}\nhello`,
        timestamp: 1710000040,
      },
    ] as RawMessage[];

    const deduped = dedupeRedundantUserMessages(messages, 1710000000000);

    expect(deduped.map((m) => m.id)).toEqual(['assistant-1', 'history-user']);
  });

  it('recovers optimistic user after run completes when history omits the opening turn', () => {
    const optimistic = {
      id: 'local-user-1',
      role: 'user',
      content: '客户成本分析 创建工作流',
      timestamp: 1710000000,
    } as RawMessage;
    const enriched = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: [{ type: 'text', text: '正在配置工作流…' }],
        timestamp: 1710000003,
      },
    ] as RawMessage[];

    const merged = mergeOptimisticUserIntoHistory(enriched, [optimistic], {
      userMessageAt: null,
      sending: false,
      cachedOptimistic: optimistic,
    });

    expect(merged.map((message) => message.content)).toEqual([
      '客户成本分析 创建工作流',
      [{ type: 'text', text: '正在配置工作流…' }],
    ]);
  });

  it('reconstructs opening user turn from stored session label when history and cache are empty', () => {
    const enriched = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '参数已确认',
        timestamp: 1710000003,
      },
    ] as RawMessage[];

    const merged = recoverInitialUserFromSessionLabel(
      enriched,
      'agent:main:session-1',
      { 'agent:main:session-1': '客户成本分析 创建工作流' },
    );

    expect(merged[0]?.role).toBe('user');
    expect(merged[0]?.content).toBe('客户成本分析 创建工作流');
    expect(merged[1]?.role).toBe('assistant');
  });

  it('still restores opening user when history only has parameter-confirm user turns', () => {
    const enriched = [
      {
        id: 'user-params',
        role: 'user',
        content: '参数：统计月份=2025-06',
        timestamp: 1710000002,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '参数已确认，工作流已在后台启动执行',
        timestamp: 1710000003,
      },
    ] as RawMessage[];

    const merged = recoverInitialUserFromSessionLabel(
      enriched,
      'agent:main:session-1',
      { 'agent:main:session-1': '总部结算对账 创建工作流' },
    );

    expect(merged[0]?.role).toBe('user');
    expect(merged[0]?.content).toBe('总部结算对账 创建工作流');
    expect(merged.filter((message) => message.role === 'user')).toHaveLength(2);
  });

  it('falls back to gateway session label on cold start when memory labels are empty', () => {
    const enriched = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '已完成',
        timestamp: 1710000003,
      },
    ] as RawMessage[];

    const merged = recoverInitialUserFromSessionLabel(
      enriched,
      'agent:main:session-1',
      {},
      '总部结算对账 创建工作流',
    );

    expect(merged[0]?.role).toBe('user');
    expect(merged[0]?.content).toBe('总部结算对账 创建工作流');
  });

  it('moves a late-recovered opening user turn ahead of workflow results', () => {
    const messages = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '参数已确认，工作流已在后台启动执行',
        timestamp: 1710000003,
      },
      {
        id: 'assistant-2',
        role: 'assistant',
        content: '已完成',
        timestamp: 1710000063,
      },
      {
        id: 'session-label-user',
        role: 'user',
        content: '客户异常监控 创建工作流',
        timestamp: 1710000123,
      },
    ] as RawMessage[];

    const merged = ensureOpeningUserMessageFirst(
      messages,
      'agent:main:session-1',
      { 'agent:main:session-1': '客户异常监控 创建工作流' },
    );

    expect(merged[0]?.role).toBe('user');
    expect(merged[0]?.content).toBe('客户异常监控 创建工作流');
    expect(merged[1]?.role).toBe('assistant');
  });

  it('inserts skill-only optimistic user when history has not caught up', () => {
    const optimistic = {
      id: 'local-skill-user',
      role: 'user',
      content: '',
      timestamp: 1710000000,
      _skillMeta: { slug: 'outlet-quote', title: '网点一客一议报价' },
    } as RawMessage;
    const enriched = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '连接模型中...',
        timestamp: 1710000003,
      },
    ] as RawMessage[];

    const merged = mergeOptimisticUserIntoHistory(enriched, [optimistic], {
      userMessageAt: 1710000000000,
      sending: true,
    });

    expect(merged).toHaveLength(2);
    expect(merged[0]?._skillMeta).toEqual({ slug: 'outlet-quote', title: '网点一客一议报价' });
    expect(merged[0]?.content).toBe('');
  });

  it('preserves skill tag and hides defaultPrompt when history echoes the user turn', () => {
    const optimistic = {
      id: 'local-skill-user',
      role: 'user',
      content: '',
      timestamp: 1710000000,
      _skillMeta: { slug: 'outlet-quote', title: '网点一客一议报价' },
    } as RawMessage;
    const enriched = [
      {
        id: 'local-skill-user',
        role: 'user',
        content: '请帮我完成网点一客一议报价流程',
        timestamp: 1710000001,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '连接模型中...',
        timestamp: 1710000003,
      },
    ] as RawMessage[];

    const merged = mergeOptimisticUserIntoHistory(enriched, [optimistic], {
      userMessageAt: 1710000000000,
      sending: true,
    });

    expect(merged[0]?._skillMeta).toEqual({ slug: 'outlet-quote', title: '网点一客一议报价' });
    expect(merged[0]?.content).toBe('');
    expect(merged[1]?.role).toBe('assistant');
  });

  it('preserves skill tag when deduping adjacent optimistic and gateway user messages', () => {
    const messages = [
      {
        id: 'history-user',
        role: 'user',
        content: '请帮我完成网点出库运费流程',
        timestamp: 1710000001,
      },
      {
        id: 'local-skill-user',
        role: 'user',
        content: '查网点432100的',
        timestamp: 1710000000,
        _skillMeta: { slug: 'outlet-freight', title: '网点出库运费' },
      },
    ] as RawMessage[];

    const deduped = dedupeRedundantUserMessages(messages, 1710000000000);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?._skillMeta).toEqual({ slug: 'outlet-freight', title: '网点出库运费' });
    expect(deduped[0]?.content).toBe('查网点432100的');
  });

  it('patches skill display after send completes when lastUserMessageAt was cleared', () => {
    const optimistic = {
      id: 'local-skill-user',
      role: 'user',
      content: '查网点432100的',
      timestamp: 1710000000,
      _skillMeta: { slug: 'outlet-freight', title: '网点出库运费' },
    } as RawMessage;
    const enriched = [
      {
        id: 'history-user',
        role: 'user',
        content: '请帮我完成网点出库运费流程\n\n查网点432100的',
        timestamp: 1710000001,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '好的',
        timestamp: 1710000003,
      },
    ] as RawMessage[];

    const merged = mergeOptimisticUserIntoHistory(enriched, [optimistic], {
      userMessageAt: null,
      sending: false,
    });

    expect(merged[0]?._skillMeta).toEqual({ slug: 'outlet-freight', title: '网点出库运费' });
    expect(merged[0]?.content).toBe('查网点432100的');
  });

  it('does not recover session-label user when a skill-tagged opening turn already exists', () => {
    const enriched = [
      {
        id: 'history-user',
        role: 'user',
        content: '查网点432100的',
        timestamp: 1710000001,
        _skillMeta: { slug: 'waybill-quote', title: '网点面单报价' },
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '好的',
        timestamp: 1710000003,
      },
    ] as RawMessage[];

    const merged = recoverInitialUserFromSessionLabel(
      enriched,
      'agent:main:session-1',
      { 'agent:main:session-1': '网点面单报价' },
    );

    expect(merged.filter((message) => message.role === 'user')).toHaveLength(1);
  });

  it('dedupes synthetic session-label user rows after skill history restore', () => {
    const messages = [
      {
        id: 'session-label-user-agent:main:session-1',
        role: 'user',
        content: '查网点432100的',
        timestamp: 1710000000,
      },
      {
        id: 'history-user',
        role: 'user',
        content: '查网点432100的',
        timestamp: 1710000001,
        _skillMeta: { slug: 'waybill-quote', title: '网点面单报价' },
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '好的',
        timestamp: 1710000003,
      },
    ] as RawMessage[];

    const deduped = dedupeRedundantUserMessages(messages, null);
    const cleaned = dropSyntheticSkillSessionLabelUsers(deduped);

    expect(cleaned.filter((message) => message.role === 'user')).toHaveLength(1);
    expect(cleaned[0]?._skillMeta).toEqual({ slug: 'waybill-quote', title: '网点面单报价' });
    expect(cleaned[0]?.content).toBe('查网点432100的');
  });

  it('keeps only the skill tag for skill-only refresh when gateway stored the title', () => {
    const skill = { slug: 'outlet-fee', title: '网点出港派费' };
    const history = restoreSkillMetaOnMessages(
      [{
        id: 'history-user',
        role: 'user',
        content: appendSkillTranscriptMarker(skill.title, skill),
        timestamp: 1710000001,
      }],
      'agent:main:session-1',
      skill.title,
    );

    expect(history[0]?._skillMeta).toEqual(skill);
    expect(history[0]?.content).toBe('');
  });

  it('does not recover opening user from label while sending', () => {
    const enriched = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '思考中…',
        timestamp: 1710000003,
      },
    ] as RawMessage[];

    const merged = recoverInitialUserFromSessionLabel(
      enriched,
      'agent:main:session-1',
      { 'agent:main:session-1': '帮我写周报' },
      undefined,
      { sending: true },
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.role).toBe('assistant');
  });

  it('does not reorder opening user while sending', () => {
    const messages = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'ok',
        timestamp: 1710000003,
      },
      {
        id: 'user-1',
        role: 'user',
        content: '帮我写周报',
        timestamp: 1710000123,
      },
    ] as RawMessage[];

    const merged = ensureOpeningUserMessageFirst(
      messages,
      'agent:main:session-1',
      { 'agent:main:session-1': '帮我写周报' },
      undefined,
      { sending: true },
    );

    expect(merged.map((m) => m.id)).toEqual(['assistant-1', 'user-1']);
  });

  it('drops non-adjacent synthetic session-label user when history has same text', () => {
    const messages = [
      {
        id: 'session-label-user-agent:main:session-1',
        role: 'user',
        content: '帮我写周报',
        timestamp: 1710000001,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '好的',
        timestamp: 1710000002,
      },
      {
        id: 'history-user-1',
        role: 'user',
        content: '帮我写周报',
        timestamp: 1710000003,
      },
    ] as RawMessage[];

    const deduped = dedupeRedundantUserMessages(messages, null, {
      sessionKey: 'agent:main:session-1',
    });

    expect(deduped.filter((m) => m.role === 'user')).toHaveLength(1);
    expect(deduped.find((m) => m.role === 'user')?.id).toBe('history-user-1');
  });

});
