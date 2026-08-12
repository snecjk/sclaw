import { describe, expect, it } from 'vitest';
import {
  normalizeUserMessageForDisplay,
  stripComposerGatewayPlaceholders,
  stripComposerModelBakeForDisplay,
} from '@/lib/user-message-display';
import {
  findHistoryUserEcho,
  isSameUserMessage,
  mergeOptimisticUserIntoHistory,
  patchComposerUserMessageFromOptimistic,
} from '@/stores/chat/user-message-merge';
import { buildChatDisplayModel } from '@/stores/chat/display-model';
import { createClientSessionState } from '@/stores/chat/client-session-reducer';
import { synthesizeComposerSegments } from '@/components/input-composer/user-composer-segments';
import type { RawMessage } from '@/stores/chat/types';

describe('composer echo pairing & display', () => {
  it('strips stage-6 file/skill placeholders for display', () => {
    expect(stripComposerGatewayPlaceholders(
      '[文件: 店铺库存.xlsx]将表中的数据生成一份 json',
    )).toBe('将表中的数据生成一份 json');
    expect(normalizeUserMessageForDisplay(
      '使用 [技能: 报表] 生成 html',
    )).toBe('使用 生成 html');
  });

  it('normalizeUserMessageForDisplay preserves newlines for bubble rendering', () => {
    expect(normalizeUserMessageForDisplay(
      '要求：\n\n📊 核心数据\n- 总发件量：1\n- 活跃客户：2',
    )).toBe('要求：\n\n📊 核心数据\n- 总发件量：1\n- 活跃客户：2');
  });

  it('pairs optimistic displayText with gateway history that contains file placeholders', () => {
    const optimistic = {
      id: 'local-file-1',
      role: 'user',
      content: '将表中的数据生成一份 json',
      timestamp: 1710000000,
      _attachedFiles: [{
        fileName: '店铺库存.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileSize: 136200,
        preview: null,
        filePath: '/tmp/shop.xlsx',
      }],
      _composerSegments: [
        {
          type: 'file',
          fileName: '店铺库存.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          fileSize: 136200,
          preview: null,
          filePath: '/tmp/shop.xlsx',
          stagedPath: '/tmp/shop.xlsx',
        },
        { type: 'text', text: '将表中的数据生成一份 json' },
      ],
    } as RawMessage;

    const historyUser = {
      id: 'history-file-1',
      role: 'user',
      content: '[文件: 店铺库存.xlsx]将表中的数据生成一份 json',
      timestamp: 1710000002,
    } as RawMessage;

    expect(isSameUserMessage(historyUser, optimistic, 1710000000000)).toBe(true);

    const merged = mergeOptimisticUserIntoHistory([historyUser], [optimistic], {
      userMessageAt: 1710000000000,
      sending: true,
      cachedOptimistic: optimistic,
    });
    const user = merged.find((m) => m.role === 'user');
    expect(user?.content).toBe('将表中的数据生成一份 json');
    expect(user?._composerSegments).toEqual(optimistic._composerSegments);
    expect(String(user?.content)).not.toContain('[文件:');
  });

  it('pairs optimistic displayText with workflow exec bake history', () => {
    const optimistic = {
      id: 'local-wf-1',
      role: 'user',
      content: '执行这个工作流',
      timestamp: 1710000000,
      _composerSegments: [
        { type: 'workflow', id: 'wf-42', name: '我的工作流', source: 'mine' },
        { type: 'text', text: '执行这个工作流' },
      ],
    } as RawMessage;

    const historyUser = {
      id: 'history-wf-1',
      role: 'user',
      content: '帮我执行 id 为：wf-42 的工作流 【我的工作流】执行这个工作流',
      timestamp: 1710000002,
    } as RawMessage;

    expect(stripComposerModelBakeForDisplay(String(historyUser.content))).toBe('执行这个工作流');
    expect(isSameUserMessage(historyUser, optimistic, 1710000000000)).toBe(true);

    const patched = patchComposerUserMessageFromOptimistic(historyUser, optimistic);
    expect(patched.content).toBe('执行这个工作流');
    expect(patched._composerSegments?.[0]).toMatchObject({ type: 'workflow', id: 'wf-42' });
  });

  it('does not append optimistic when projection already has a paired user', () => {
    const optimistic = {
      id: 'local-1',
      role: 'user' as const,
      content: '将表中的数据生成一份 json',
      timestamp: 1710000000,
      _attachedFiles: [{
        fileName: 'a.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileSize: 1,
        preview: null,
        filePath: '/tmp/a.xlsx',
      }],
    };
    const historyUser = {
      id: 'history-1',
      role: 'user' as const,
      content: '[文件: a.xlsx]将表中的数据生成一份 json',
      timestamp: 1710000001,
      _composerSegments: optimistic._composerSegments,
    };
    const overlay = {
      ...createClientSessionState().overlay,
      optimisticUserMessage: optimistic,
    };
    const projected = buildChatDisplayModel([historyUser], overlay);
    expect(projected.filter((m) => m.role === 'user')).toHaveLength(1);
    expect(projected[0]?.id).toBe('history-1');
  });

  it('synthesize strips file placeholders instead of stacking them with chips', () => {
    const message = {
      role: 'user',
      content: '[文件: a.xlsx]将表中的数据生成一份 json',
      _attachedFiles: [{
        fileName: 'a.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileSize: 10,
        preview: null,
        filePath: '/tmp/a.xlsx',
      }],
    } as RawMessage;

    const segments = synthesizeComposerSegments(
      message,
      String(message.content),
      undefined,
      message._attachedFiles,
    );
    expect(segments).toBeTruthy();
    const textParts = (segments ?? [])
      .filter((s): s is { type: 'text'; text: string } => s.type === 'text')
      .map((s) => s.text)
      .join('');
    expect(textParts).not.toContain('[文件:');
    expect(textParts).toContain('将表中的数据生成一份 json');
    expect(segments?.some((s) => s.type === 'file')).toBe(true);
  });

  it('re-applies composer segments from previous display after overlay optimistic is cleared', () => {
    const segments = [
      { type: 'workflow' as const, id: 'wf-1', name: '七夕问候语', source: 'mine' },
      { type: 'text' as const, text: '执行这个工作流，并将结果发送到 ' },
      {
        type: 'mention' as const,
        mention: { type: 'user' as const, displayName: '申通sclaw123', userId: 'u-1' },
      },
    ];
    const previousDisplay = [{
      id: 'history-wf-1',
      role: 'user',
      content: '执行这个工作流，并将结果发送到 @申通sclaw123',
      timestamp: 1710000002,
      _composerSegments: segments,
    }] as RawMessage[];

    // 第二次 history 重载：原始 gateway 载荷，无 overlay 乐观消息。
    const freshHistory = [{
      id: 'history-wf-1',
      role: 'user',
      content: '帮我执行 id 为：wf-1 的工作流 【七夕问候语】执行这个工作流，并将结果发送到 @申通sclaw123',
      timestamp: 1710000002,
    }] as RawMessage[];

    const merged = mergeOptimisticUserIntoHistory(freshHistory, previousDisplay, {
      userMessageAt: 1710000000000,
      sending: true,
      cachedOptimistic: null,
    });

    expect(merged[0]?._composerSegments).toEqual(segments);
    expect(merged[0]?.content).toBe('执行这个工作流，并将结果发送到 @申通sclaw123');
    expect(String(merged[0]?.content)).not.toContain('帮我执行');
  });

  it('does not overwrite an edited re-send with the previous skill turn mid-thinking', () => {
    const oldSegments = [
      { type: 'text' as const, text: '根据 ' },
      {
        type: 'file' as const,
        fileName: 'a.xlsx',
        mimeType: 'application/octet-stream',
        fileSize: 1,
        preview: null,
        stagedPath: '/tmp/a.xlsx',
      },
      { type: 'text' as const, text: ' 使用 ' },
      { type: 'skill' as const, slug: 'html', title: '姚磊html网页设计' },
      { type: 'text' as const, text: ' 生成一份 html，并将结果发送给 ' },
      {
        type: 'mention' as const,
        mention: {
          type: 'group' as const,
          displayName: '申通sclaw123',
          openConversationId: 'cid1',
        },
      },
    ];
    const newSegments = [
      { type: 'text' as const, text: '根据 ' },
      {
        type: 'file' as const,
        fileName: 'a.xlsx',
        mimeType: 'application/octet-stream',
        fileSize: 1,
        preview: null,
        stagedPath: '/tmp/a.xlsx',
      },
      { type: 'text' as const, text: ' 使用 ' },
      { type: 'skill' as const, slug: 'html', title: '姚磊html网页设计' },
      { type: 'text' as const, text: ' 再重新生成2份 风格不同的html' },
    ];

    const previousDisplay = [
      {
        id: 'user-old',
        role: 'user',
        content: '根据  使用  生成一份 html，并将结果发送给 @申通sclaw123',
        timestamp: 1710000000,
        _skillMeta: { slug: 'html', title: '姚磊html网页设计' },
        _composerSegments: oldSegments,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'done',
        timestamp: 1710000005,
      },
      {
        id: 'user-new',
        role: 'user',
        content: '根据  使用  再重新生成2份 风格不同的html',
        timestamp: 1710000010,
        _skillMeta: { slug: 'html', title: '姚磊html网页设计' },
        _composerSegments: newSegments,
      },
    ] as RawMessage[];

    const freshHistory = [
      {
        id: 'user-old',
        role: 'user',
        content: '根据 [文件: a.xlsx] 使用 [技能: 姚磊html网页设计] 生成一份 html，并将结果发送给 @申通sclaw123',
        timestamp: 1710000000,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'done',
        timestamp: 1710000005,
      },
      {
        id: 'user-new',
        role: 'user',
        content: '姚磊html网页设计\n\n根据 [文件: a.xlsx] 使用 [技能: 姚磊html网页设计] 再重新生成2份 风格不同的html\n<!-- SClaw-Skill {"slug":"html","title":"姚磊html网页设计","userText":"根据 使用 再重新生成2份 风格不同的html"} -->',
        timestamp: 1710000010,
      },
    ] as RawMessage[];

    const merged = mergeOptimisticUserIntoHistory(freshHistory, previousDisplay, {
      userMessageAt: 1710000010000,
      sending: true,
      cachedOptimistic: null,
    });

    const users = merged.filter((message) => message.role === 'user');
    expect(users).toHaveLength(2);
    expect(users[1]?.content).toBe('根据  使用  再重新生成2份 风格不同的html');
    expect(users[1]?._composerSegments).toEqual(newSegments);
    expect(String(users[1]?.content)).not.toContain('生成一份 html');
    expect(String(users[0]?.content)).toContain('生成一份 html');
  });

  it('does not pair an edited skill re-send to the previous turn inside the 5s window', () => {
    const oldUser = {
      id: 'user-old',
      role: 'user' as const,
      content: '根据 [文件: a.xlsx] 使用 [技能: 姚磊html网页设计] 生成一份 html',
      timestamp: 1710000000,
    };
    const newOptimistic = {
      id: 'local-new',
      role: 'user' as const,
      content: '根据  使用  再重新生成2份 风格不同的html',
      timestamp: 1710000002, // 旧轮次后 2 秒——仍在 OPTIMISTIC_SEND_WINDOW_MS 内
      _skillMeta: { slug: 'html', title: '姚磊html网页设计' },
      _composerSegments: [
        { type: 'text' as const, text: '根据 ' },
        {
          type: 'file' as const,
          fileName: 'a.xlsx',
          mimeType: 'application/octet-stream',
          fileSize: 1,
          preview: null,
          stagedPath: '/tmp/a.xlsx',
        },
        { type: 'text' as const, text: ' 使用 ' },
        { type: 'skill' as const, slug: 'html', title: '姚磊html网页设计' },
        { type: 'text' as const, text: ' 再重新生成2份 风格不同的html' },
      ],
    };

    // 仅靠时间会误配对；证据/软后缀必须拒绝。
    expect(isSameUserMessage(oldUser, newOptimistic, 1710000002000)).toBe(false);
    expect(findHistoryUserEcho([oldUser], newOptimistic, 1710000002000)).toBeUndefined();

    const overlay = {
      ...createClientSessionState().overlay,
      optimisticUserMessage: newOptimistic,
    };
    const projected = buildChatDisplayModel([oldUser], overlay);
    const users = projected.filter((message) => message.role === 'user');
    expect(users).toHaveLength(2);
    expect(users[1]?.id).toBe('local-new');
  });

  it('still pairs skill first echo when gateway prefixes defaultPrompt within 5s', () => {
    const optimistic = {
      id: 'local-skill',
      role: 'user' as const,
      content: '查网点432100的',
      timestamp: 1710000000,
      _skillMeta: { slug: 'outlet-freight', title: '网点出库运费' },
    };
    const historyUser = {
      id: 'history-skill',
      role: 'user' as const,
      content: '请帮我完成网点出库运费流程\n\n查网点432100的',
      timestamp: 1710000001,
    };

    expect(isSameUserMessage(historyUser, optimistic, 1710000000000)).toBe(true);
  });
});
