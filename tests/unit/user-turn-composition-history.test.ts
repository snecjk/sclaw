// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listAcceptedForHistoryRange = vi.fn();
const deleteExpiredPendingAndRejected = vi.fn();
const bindProviderMessageId = vi.fn();
const listAcceptedByMessageIds = vi.fn();

vi.mock('../../electron/db/repositories/chat-user-turn-composition-repository', () => ({
  getChatUserTurnCompositionRepository: () => ({
    listAcceptedForHistoryRange,
    deleteExpiredPendingAndRejected,
    bindProviderMessageId,
    listAcceptedByMessageIds,
  }),
}));

import { projectUserTurnCompositions } from '../../electron/services/user-turn-composition-history';

describe('projectUserTurnCompositions', () => {
  beforeEach(() => {
    listAcceptedForHistoryRange.mockReset();
    deleteExpiredPendingAndRejected.mockReset().mockResolvedValue(undefined);
    bindProviderMessageId.mockReset().mockResolvedValue(undefined);
    listAcceptedByMessageIds.mockReset().mockResolvedValue([]);
  });

  it('uses the accepted sidecar as the user bubble composition truth', async () => {
    listAcceptedForHistoryRange.mockResolvedValue([{
      sessionKey: 'pi:main:test',
      idempotencyKey: 'turn-1',
      runId: 'run-1',
      engineType: 'pi',
      status: 'accepted',
      displayText: '比较 和 ',
      sourceText: '比较 [文件: A.xlsx] 和 [技能: 报价助手]',
      messageFingerprint: '比较和',
      providerMessageId: null,
      composition: {
        version: 1,
        segments: [
          { type: 'text', text: '比较 ' },
          { type: 'attachment', mediaIndex: 0, displayName: 'A.xlsx' },
          { type: 'text', text: ' 和 ' },
          { type: 'mention', displayName: '张三', mentionIndex: 0 },
          { type: 'skill', slug: 'quote-assistant', title: '报价助手' },
        ],
      },
      attachments: [{
        filePath: 'C:\\tmp\\uuid.xlsx',
        fileName: 'A.xlsx',
        suppliedMimeType: 'application/octet-stream',
        detectedMimeType: null,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        byteSize: 12,
        kind: 'file',
      }],
      hostMetadata: {
        dingTalkMentions: [{ type: 'user', displayName: '张三', userId: 'user-1' }],
      },
      error: null,
      createdAt: new Date().toISOString(),
    }]);

    const projected = await projectUserTurnCompositions('pi:main:test', {
      messages: [
        { role: 'user', idempotencyKey: 'turn-1', content: '<file name="uuid.xlsx"></file>' },
        { role: 'assistant', content: '完成' },
      ],
    });
    const user = projected.messages[0] as Record<string, unknown>;
    expect(user.content).toBe('比较 和 ');
    expect(user._skillMetas).toEqual([{ slug: 'quote-assistant', title: '报价助手' }]);
    expect(user._composerSegments).toEqual([
      { type: 'text', text: '比较 ' },
      expect.objectContaining({ type: 'file', fileName: 'A.xlsx', filePath: 'C:\\tmp\\uuid.xlsx' }),
      { type: 'text', text: ' 和 ' },
      { type: 'mention', mention: { type: 'user', displayName: '张三', userId: 'user-1' } },
      { type: 'skill', slug: 'quote-assistant', title: '报价助手' },
    ]);
  });

  it('pairs an engine echo without ids by normalized display-text fingerprint', async () => {
    const createdAt = new Date().toISOString();
    listAcceptedForHistoryRange.mockResolvedValue([{
      sessionKey: 'pi:main:test',
      idempotencyKey: 'turn-without-echo-id',
      runId: null,
      engineType: 'pi',
      status: 'accepted',
      displayText: '比较两份报价',
      sourceText: '比较两份报价[文件: A.xlsx]',
      messageFingerprint: '比较两份报价',
      providerMessageId: null,
      composition: {
        version: 1,
        segments: [{ type: 'text', text: '比较两份报价' }],
      },
      attachments: [],
      hostMetadata: {},
      error: null,
      createdAt,
    }]);

    const projected = await projectUserTurnCompositions('pi:main:test', {
      messages: [{ role: 'user', timestamp: createdAt, content: '比较 两份报价<file name="C:\\tmp\\A.xlsx"></file>' }],
    });
    expect(projected.messages[0]).toEqual(expect.objectContaining({
      content: '比较两份报价',
      _composerSegments: [{ type: 'text', text: '比较两份报价' }],
    }));
  });

  it('does not force an ambiguous sidecar onto an existing user message or touch assistant messages', async () => {
    const now = Date.now();
    const makeTurn = (idempotencyKey: string, offset: number) => ({
      sessionKey: 'pi:main:test',
      idempotencyKey,
      runId: null,
      engineType: 'pi',
      status: 'accepted',
      displayText: '重复正文',
      sourceText: '重复正文',
      messageFingerprint: '重复正文',
      providerMessageId: null,
      composition: { version: 1, segments: [{ type: 'text', text: '重复正文' }] },
      attachments: [],
      hostMetadata: {},
      error: null,
      createdAt: new Date(now + offset).toISOString(),
    });
    listAcceptedForHistoryRange.mockResolvedValue([
      makeTurn('turn-a', -1_000),
      makeTurn('turn-b', 1_000),
    ]);
    const original = {
      messages: [
        { role: 'user', timestamp: now, content: '重复正文' },
        { role: 'assistant', timestamp: now + 2_000, content: '原始回答' },
      ],
    };
    const projected = await projectUserTurnCompositions('pi:main:test', original);
    expect(projected.messages).toEqual(original.messages);
    expect(bindProviderMessageId).not.toHaveBeenCalled();
  });

  it('keeps an accepted sidecar unprojected while its provider echo is absent', async () => {
    listAcceptedForHistoryRange.mockResolvedValue([{
      sessionKey: 'pi:main:test',
      idempotencyKey: 'future-turn',
      runId: null,
      engineType: 'pi',
      status: 'accepted',
      displayText: '新消息',
      sourceText: '新消息',
      messageFingerprint: '新消息',
      providerMessageId: null,
      composition: { version: 1, segments: [{ type: 'text', text: '新消息' }] },
      attachments: [],
      hostMetadata: {},
      error: null,
      createdAt: new Date().toISOString(),
    }]);
    const oldMessage = { role: 'user', timestamp: Date.now() - 60 * 60_000, content: '旧消息' };
    const projected = await projectUserTurnCompositions('pi:main:test', { messages: [oldMessage] });
    expect(projected.messages).toEqual([oldMessage]);
  });

  it('pairs repeated text globally by nearest timestamps instead of message iteration order', async () => {
    const now = Date.now();
    const makeTurn = (idempotencyKey: string, displayText: string, timestamp: number) => ({
      sessionKey: 'pi:main:test', idempotencyKey, runId: null, engineType: 'pi', status: 'accepted',
      displayText, sourceText: displayText, messageFingerprint: '重复', providerMessageId: null,
      composition: { version: 1, segments: [{ type: 'text', text: displayText }] },
      attachments: [], hostMetadata: {}, error: null, createdAt: new Date(timestamp).toISOString(),
    });
    listAcceptedForHistoryRange.mockResolvedValue([
      makeTurn('early', '早', now),
      makeTurn('late', '晚', now + 10_000),
    ]);
    const projected = await projectUserTurnCompositions('pi:main:test', {
      messages: [
        { role: 'user', timestamp: now + 9_000, content: '重复' },
        { role: 'user', timestamp: now + 1_000, content: '重复' },
      ],
    });
    expect((projected.messages[0] as { content: string }).content).toBe('晚');
    expect((projected.messages[1] as { content: string }).content).toBe('早');
  });
});
