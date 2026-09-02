import { describe, expect, it } from 'vitest';
import type { RawMessage } from '@/stores/chat';
import {
  messageContentCacheFingerprint,
  parseThinkingTurnLayout,
  parseThinkingTurnLayoutCached,
} from '@/pages/Chat/thinking-turn-segments';

function assistantSnapshot(id: string, thinking: string, text?: string): RawMessage {
  const content: Array<Record<string, unknown>> = [{ type: 'thinking', thinking }];
  if (text) content.push({ type: 'text', text });
  return { id, role: 'assistant', content, timestamp: 1 } as RawMessage;
}

describe('parseThinkingTurnLayoutCached（chat-thinking-perf 3.4 保守缓存）', () => {
  it('输入引用完全未变时复用同一结果引用（下游 memo 链保持）', () => {
    const messages = [assistantSnapshot('m1', '思考内容')];
    const options = { isLiveStream: true };
    const first = parseThinkingTurnLayoutCached('turn-1', messages, options);
    const second = parseThinkingTurnLayoutCached('turn-1', messages, options);
    expect(second).toBe(first);
  });

  it('流式追加（新 snapshot 对象）后重算，且输出与全量解析等价', () => {
    const grown = [assistantSnapshot('m1', '思考内容变长了，追加了一段')];
    const options = { isLiveStream: true };
    const cachedResult = parseThinkingTurnLayoutCached('turn-2', grown, options);
    const directResult = parseThinkingTurnLayout(grown, options);
    expect(cachedResult).toEqual(directResult);

    // 同一 turn 再次以相同输入命中缓存
    expect(parseThinkingTurnLayoutCached('turn-2', grown, options)).toBe(cachedResult);
  });

  it('options 标量变化（isLiveStream 翻转）后重算', () => {
    const messages = [assistantSnapshot('m1', '思考内容', '正文')];
    const live = parseThinkingTurnLayoutCached('turn-3', messages, { isLiveStream: true });
    const done = parseThinkingTurnLayoutCached('turn-3', messages, { isLiveStream: false });
    expect(done).not.toBe(live);
    expect(done).toEqual(parseThinkingTurnLayout(messages, { isLiveStream: false }));
  });

  it('不同 turn 的 cacheKey 互不污染', () => {
    const messagesA = [assistantSnapshot('a1', '甲轮思考')];
    const messagesB = [assistantSnapshot('b1', '乙轮思考', '乙轮正文')];
    const resultA = parseThinkingTurnLayoutCached('turn-a', messagesA, { isLiveStream: false });
    const resultB = parseThinkingTurnLayoutCached('turn-b', messagesB, { isLiveStream: false });
    expect(resultA).not.toBe(resultB);
    expect(parseThinkingTurnLayoutCached('turn-a', messagesA, { isLiveStream: false })).toBe(resultA);
  });

  it('无 cacheKey 时直出不缓存', () => {
    const messages = [assistantSnapshot('m1', '思考内容')];
    const first = parseThinkingTurnLayoutCached(undefined, messages, { isLiveStream: false });
    const second = parseThinkingTurnLayoutCached(undefined, messages, { isLiveStream: false });
    expect(second).not.toBe(first);
    expect(second).toEqual(first);
  });

  it('原地加长同一块 thinking 时指纹变化且不复用脏 parse 缓存', () => {
    const message = assistantSnapshot('m1', '短');
    const messages = [message];
    const before = messageContentCacheFingerprint(message);
    const first = parseThinkingTurnLayoutCached('turn-mut', messages, { isLiveStream: true });

    const block = (message.content as Array<{ thinking?: string }>)[0];
    expect(block).toBeTruthy();
    block!.thinking = '短思考变长了，同一引用';
    expect(messageContentCacheFingerprint(message)).not.toBe(before);

    const second = parseThinkingTurnLayoutCached('turn-mut', messages, { isLiveStream: true });
    expect(second).not.toBe(first);
    expect(second).toEqual(parseThinkingTurnLayout(messages, { isLiveStream: true }));
  });
});
