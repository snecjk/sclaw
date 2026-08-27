import { describe, expect, it } from 'vitest';
import {
  normalizeUserMessageForDisplay,
  stripComposerGatewayPlaceholders,
  stripComposerModelBakeForDisplay,
} from '@/lib/user-message-display';
import {
  dedupeRedundantUserMessages,
  findHistoryUserEcho,
  isSameUserMessage,
  mergeOptimisticUserIntoHistory,
  patchComposerUserMessageFromOptimistic,
} from '@/stores/chat/user-message-merge';
import { buildChatDisplayModel } from '@/stores/chat/display-model';
import { createClientSessionState } from '@/stores/chat/client-session-reducer';
import { synthesizeComposerSegments, hydrateComposerSegmentsOnMessages } from '@/components/input-composer/user-composer-segments';
import { sanitizePersistedTextSegmentForEdit } from '@/components/input-composer/use-input-composer-edit-draft';
import { restoreSkillMetaOnMessages } from '@/lib/skill-message-meta-cache';
import { stripUserNoiseKeepComposerBake, stripGatewayTimestampPrefix } from '@/lib/user-message-display';
import { stripSkillGatewayPrefix } from '@/lib/skill-transcript-marker';
import { resolveSkillFromPlaza } from '@/lib/skill-plaza-resolve';
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

  it('pairs learning-center / template workflow handoff (no source) after unified bake', () => {
    const suffix = '按客户维度拆解发件成本与利润，自动识别成本异常并生成分析报告';
    const optimistic = {
      id: 'local-wf-tpl-1',
      role: 'user',
      content: suffix,
      timestamp: 1710000000,
      _composerSegments: [
        { type: 'workflow', id: 'wf_tpl_cost', name: '客户成本分析' },
        { type: 'text', text: suffix },
      ],
    } as RawMessage;

    // 旧行为：无 source 时 gateway 把名字当纯文本 → strip 后对不上 displayText。
    // 统一 bake 后 history 与 mine 同形，可配对。
    const historyUser = {
      id: 'history-wf-tpl-1',
      role: 'user',
      content: `帮我执行 id 为：wf_tpl_cost 的工作流 【客户成本分析】${suffix}`,
      timestamp: 1710000002,
    } as RawMessage;

    expect(stripComposerModelBakeForDisplay(String(historyUser.content))).toBe(suffix);
    expect(isSameUserMessage(historyUser, optimistic, 1710000000000)).toBe(true);

    const merged = mergeOptimisticUserIntoHistory([historyUser], [optimistic], {
      userMessageAt: 1710000000000,
      sending: true,
      cachedOptimistic: optimistic,
    });
    const user = merged.find((m) => m.role === 'user');
    expect(user?.content).toBe(suffix);
    expect(user?._composerSegments?.[0]).toMatchObject({
      type: 'workflow',
      id: 'wf_tpl_cost',
      name: '客户成本分析',
    });
    expect(merged.filter((m) => m.role === 'user')).toHaveLength(1);
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

  it('does not pair skill-only optimistic with a different-skill echo (tag mix-up)', () => {
    const pdfEcho = {
      id: 'history-pdf',
      role: 'user' as const,
      content: 'pdf\n\n[技能: pdf]\n<!-- SClaw-Skill {"slug":"pdf","title":"pdf"} -->',
      timestamp: 1710000001,
    } as RawMessage;
    const xlsxOptimistic = {
      id: 'local-xlsx',
      role: 'user' as const,
      content: '',
      timestamp: 1710000002,
      _skillMeta: { slug: 'xlsx', title: 'xlsx' },
      _composerSegments: [{ type: 'skill' as const, slug: 'xlsx', title: 'xlsx' }],
    } as RawMessage;

    // 5s 紧窗口内也不许跨 slug 配对。
    expect(isSameUserMessage(pdfEcho, xlsxOptimistic, 1710000002000)).toBe(false);
    expect(findHistoryUserEcho([pdfEcho], xlsxOptimistic, 1710000002000)).toBeUndefined();

    // 展示模型：不得把 xlsx 标签贴到 pdf 回显上，乐观消息应作为独立气泡保留。
    const overlay = {
      ...createClientSessionState().overlay,
      optimisticUserMessage: xlsxOptimistic,
    };
    const projected = buildChatDisplayModel([pdfEcho], overlay);
    const users = projected.filter((message) => message.role === 'user');
    expect(users).toHaveLength(2);
    expect(users[0]?._skillMeta).toBeUndefined();
    expect(users[1]?.id).toBe('local-xlsx');
  });

  it('does not pair same-text turns carrying different skills (A/B consecutive sends)', () => {
    // 技能 A 发「分析财报」后技能 B 又发「分析财报」：文案与软后缀证据都会命中，
    // slug 冲突必须在所有配对路径上否决，否则 B 的乐观消息被贴到 A 的回显上。
    const echoA = {
      id: 'history-a',
      role: 'user' as const,
      content: '分析财报\n<!-- SClaw-Skill {"slug":"skill-a","title":"技能A","userText":"分析财报"} -->',
      timestamp: 1710000001,
    } as RawMessage;
    const optimisticB = {
      id: 'local-b',
      role: 'user' as const,
      content: '分析财报',
      timestamp: 1710000002, // 1 秒后——仍在 OPTIMISTIC_SEND_WINDOW_MS 内
      _skillMeta: { slug: 'skill-b', title: '技能B' },
      _composerSegments: [
        { type: 'skill' as const, slug: 'skill-b', title: '技能B' },
        { type: 'text' as const, text: '分析财报' },
      ],
    } as RawMessage;

    expect(isSameUserMessage(echoA, optimisticB, 1710000002000)).toBe(false);
    expect(findHistoryUserEcho([echoA], optimisticB, 1710000002000)).toBeUndefined();
  });

  it('dedupe keeps adjacent same-text user turns with conflicting skill slugs', () => {
    const first = {
      id: 'u-a',
      role: 'user' as const,
      content: '分析财报',
      timestamp: 1710000000,
      _skillMeta: { slug: 'skill-a', title: '技能A' },
    } as RawMessage;
    const second = {
      id: 'u-b',
      role: 'user' as const,
      content: '分析财报',
      timestamp: 1710000001,
      _skillMeta: { slug: 'skill-b', title: '技能B' },
    } as RawMessage;

    const out = dedupeRedundantUserMessages([first, second], null);
    expect(out).toHaveLength(2);
  });

  it('still pairs skill-only optimistic with a same-skill echo', () => {
    const pdfEcho = {
      id: 'history-pdf',
      role: 'user' as const,
      content: 'pdf\n\n[技能: pdf]\n<!-- SClaw-Skill {"slug":"pdf","title":"pdf"} -->',
      timestamp: 1710000001,
    } as RawMessage;
    const pdfOptimistic = {
      id: 'local-pdf',
      role: 'user' as const,
      content: '',
      timestamp: 1710000002,
      _skillMeta: { slug: 'pdf', title: 'pdf' },
      _composerSegments: [{ type: 'skill' as const, slug: 'pdf', title: 'pdf' }],
    } as RawMessage;

    expect(isSameUserMessage(pdfEcho, pdfOptimistic, 1710000002000)).toBe(true);

    const overlay = {
      ...createClientSessionState().overlay,
      optimisticUserMessage: pdfOptimistic,
    };
    const projected = buildChatDisplayModel([pdfEcho], overlay);
    const users = projected.filter((message) => message.role === 'user');
    expect(users).toHaveLength(1);
    expect(users[0]?._skillMeta).toEqual({ slug: 'pdf', title: 'pdf' });
  });

  it('hydrates inline file/skill/workflow order from gateway bake without optimistic donor', () => {
    const gatewayContent = [
      '姚磊html网页设计',
      '',
      '根据 [文件: 客户流向.xlsx] 和 [文件: output_song.md] 使用 [技能: 姚磊html网页设计] 去生成一份 html 网页，并把结果发送给 @申通sclaw123 ,然后 帮我执行 id 为：wf_78f13449 的工作流 【七夕问候语】 发送给 @申通sclaw123',
      '<!-- SClaw-Skill {"slug":"html","title":"姚磊html网页设计","userText":"根据 和 使用 去生成一份 html 网页，并把结果发送给 @申通sclaw123 ,然后  发送给 @申通sclaw123"} -->',
      '[media attached: /tmp/a.xlsx (application/octet-stream) | /tmp/a.xlsx]',
      '[media attached: /tmp/b.md (text/markdown) | /tmp/b.md]',
    ].join('\n');

    const historyUser = {
      id: 'history-mixed',
      role: 'user',
      content: gatewayContent,
      timestamp: 1710000002,
      _attachedFiles: [
        {
          fileName: '客户流向.xlsx',
          mimeType: 'application/octet-stream',
          fileSize: 35229,
          preview: null,
          filePath: '/tmp/a.xlsx',
        },
        {
          fileName: '/tmp/b.md',
          mimeType: 'text/markdown',
          fileSize: 297,
          preview: null,
          filePath: '/tmp/b.md',
        },
      ],
    } as RawMessage;

    // 切会话回载：无 previousDisplay / optimistic donor
    const hydrated = hydrateComposerSegmentsOnMessages([historyUser]);
    const restored = restoreSkillMetaOnMessages(hydrated, 'agent:main:test', null);
    const user = restored[0];

    expect(user?._composerSegments?.map((s) => s.type)).toEqual([
      'text',
      'file',
      'text',
      'file',
      'text',
      'skill',
      'text',
      'workflow',
      'text',
    ]);
    expect(user?._composerSegments?.find((s) => s.type === 'workflow')).toMatchObject({
      id: 'wf_78f13449',
      name: '七夕问候语',
    });
    expect(user?._composerSegments?.filter((s) => s.type === 'file').map((s) => (
      s.type === 'file' ? s.fileName : ''
    ))).toEqual(['客户流向.xlsx', 'output_song.md']);
    const firstText = user?._composerSegments?.[0];
    expect(firstText?.type).toBe('text');
    if (firstText?.type === 'text') {
      expect(firstText.text).toContain('根据');
    }
    expect(String(user?.content)).not.toContain('[文件:');
    expect(String(user?.content)).not.toContain('帮我执行');
    expect(user?._skillMeta?.slug).toBe('html');
  });

  it('strips nested gateway timestamp + skill slug when hydrating after edit resend', () => {
    const gatewayContent = [
      '[STOCLAW:DINGTALK_RECIPIENTS:v1]',
      '```json',
      '{"version":1,"source":"stoclaw-input-mention","recipients":[]}',
      '```',
      '',
      '## StoClaw DingTalk Recipients',
      '',
      '用户消息：',
      '[Thu 2026-08-13 10:17 GMT+8] html',
      '',
      '根据 [文件: a.xlsx] 使用 [技能: 姚磊html网页设计] 去生成一份 html 网页，并把结果发送给 @申通sclaw123 ,然后 帮我执行 id 为：wf_78f13449 的工作流 【七夕问候语】 发送给 @申通sclaw123',
      '<!-- SClaw-Skill {"slug":"html","title":"姚磊html网页设计"} -->',
      '[media attached: /tmp/a.xlsx (application/octet-stream) | /tmp/a.xlsx]',
    ].join('\n');

    // 噪声层先剥时间戳；slug 留给 stripSkillGatewayPrefix / hydrate。
    expect(stripUserNoiseKeepComposerBake(gatewayContent)).not.toMatch(/\[Thu /);
    expect(stripUserNoiseKeepComposerBake(gatewayContent).startsWith('html')).toBe(true);
    expect(stripSkillGatewayPrefix(
      stripGatewayTimestampPrefix('html\n\n根据 [文件: a.xlsx] 去生成'),
      '姚磊html网页设计',
      '姚磊html网页设计',
      'html',
    )).toBe('根据 [文件: a.xlsx] 去生成');

    const historyUser = {
      id: 'history-edit-resend',
      role: 'user',
      content: gatewayContent,
      timestamp: 1710000002,
      _attachedFiles: [{
        fileName: 'a.xlsx',
        mimeType: 'application/octet-stream',
        fileSize: 10,
        preview: null,
        filePath: '/tmp/a.xlsx',
      }],
    } as RawMessage;

    const [user] = restoreSkillMetaOnMessages(
      hydrateComposerSegmentsOnMessages([historyUser]),
      'agent:main:test',
      null,
    );

    const joinedText = (user?._composerSegments ?? [])
      .filter((s): s is { type: 'text'; text: string } => s.type === 'text')
      .map((s) => s.text)
      .join('');
    expect(joinedText).not.toContain('[Thu');
    expect(joinedText).not.toMatch(/^\s*html\b/);
    expect(joinedText).toContain('根据');
    expect(user?._composerSegments?.some((s) => s.type === 'workflow')).toBe(true);
    expect(user?._composerSegments?.[0]).toMatchObject({ type: 'text' });
    if (user?._composerSegments?.[0]?.type === 'text') {
      expect(user._composerSegments[0].text.trim().startsWith('根据')).toBe(true);
    }
  });

  it('sanitizes dirty text segments when converting edit draft', () => {
    expect(sanitizePersistedTextSegmentForEdit(
      '[Thu 2026-08-13 10:17 GMT+8] html\n根据 ',
      { slug: 'html', title: '姚磊html网页设计' },
    )).toBe('根据');
    expect(sanitizePersistedTextSegmentForEdit(
      '帮我分析\n\n[media attached: /Users/yaolei/.stoclaw/openclaw/media/outbound/a.html (text/html) | /Users/yaolei/.stoclaw/openclaw/media/outbound/a.html]',
    )).toBe('帮我分析');
    expect(resolveSkillFromPlaza('missing-skill-xyz').defaultPrompt).toBe('');
  });
});
