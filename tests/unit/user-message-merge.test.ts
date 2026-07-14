import { describe, expect, it } from 'vitest';
import type { RawMessage } from '@/stores/chat/types';
import { WORKFLOW_SESSION_HINT_MARKER } from '@/lib/workflow-session-hint';
import {
  dedupeRedundantUserMessages,
  ensureOpeningUserMessageFirst,
  isSameUserMessage,
  mergeOptimisticUserIntoHistory,
  recoverInitialUserFromSessionLabel,
} from '@/stores/chat/user-message-merge';

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

  it('matches active media optimistic user even when history attachment metadata differs', () => {
    const optimistic = {
      id: 'local-user-image',
      role: 'user',
      content: '识别一下',
      timestamp: 1710000000,
      _attachedFiles: [{
        fileName: 'slide.png',
        mimeType: 'image/png',
        fileSize: 1024,
        preview: 'data:image/png;base64,abc',
        filePath: 'C:/tmp/staged-slide.png',
      }],
    } as RawMessage;
    const enriched = [
      {
        id: 'history-user-image',
        role: 'user',
        content: [
          { type: 'text', text: '识别一下' },
          { type: 'image', source: { path: '/private/runtime/slide.png' } },
        ],
        timestamp: 1710000002,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '图片识别结果',
        timestamp: 1710000003,
      },
    ] as RawMessage[];

    expect(isSameUserMessage(enriched[0], optimistic, 1710000000000)).toBe(true);

    const merged = mergeOptimisticUserIntoHistory(enriched, [optimistic], {
      userMessageAt: 1710000000000,
      sending: true,
      cachedOptimistic: optimistic,
    });

    expect(merged.filter((m) => m.role === 'user')).toHaveLength(1);
    expect(merged[0]?.id).toBe('history-user-image');
  });

  it('keeps completed same-text media user turns distinct when there is no active send', () => {
    const messages = [
      {
        id: 'user-image-1',
        role: 'user',
        content: '识别一下',
        timestamp: 1710000000,
        _attachedFiles: [{
          fileName: 'a.png',
          mimeType: 'image/png',
          fileSize: 100,
          preview: null,
          filePath: '/tmp/a.png',
        }],
      },
      {
        id: 'user-image-2',
        role: 'user',
        content: '识别一下',
        timestamp: 1710000010,
        _attachedFiles: [{
          fileName: 'b.png',
          mimeType: 'image/png',
          fileSize: 100,
          preview: null,
          filePath: '/tmp/b.png',
        }],
      },
    ] as RawMessage[];

    const deduped = dedupeRedundantUserMessages(messages, null);

    expect(deduped.map((m) => m.id)).toEqual(['user-image-1', 'user-image-2']);
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
});
