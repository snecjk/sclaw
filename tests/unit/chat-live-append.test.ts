import { describe, expect, it } from 'vitest';
import {
  applyLiveMessagePayload,
  buildLiveDeltaPayload,
  LIVE_PARTS_KEY,
  materializeLiveMessage,
  mergeLiveDeltaPayloads,
  readLiveAppend,
} from '../../shared/chat-live-append';

describe('chat live append（累计快照 → 增量后缀，不截断）', () => {
  it('同结构思考加长时只发布新增后缀，并在 overlay 拼回全文', () => {
    const first = { id: 'a1', role: 'assistant', content: [{ type: 'thinking', thinking: '先看结构' }] };
    const builtFirst = buildLiveDeltaPayload(null, first);
    expect(builtFirst.payload).toEqual(first);

    const grown = '先看结构，再改首页';
    const second = { id: 'a1', role: 'assistant', content: [{ type: 'thinking', thinking: grown }] };
    const builtSecond = buildLiveDeltaPayload(builtFirst.cursor, second);
    expect(readLiveAppend(builtSecond.payload)).toEqual({
      append: '，再改首页',
      totalLength: grown.length,
      blockIndex: 0,
      field: 'thinking',
    });
    expect(builtSecond.payload).not.toHaveProperty('content');

    const overlay = applyLiveMessagePayload(first, builtSecond.payload);
    expect((overlay?.[LIVE_PARTS_KEY] as string[]).join('')).toBe(grown);
    expect(overlay).toMatchObject({
      id: 'a1',
      content: [{ type: 'thinking', thinking: '先看结构' }],
    });
    expect(materializeLiveMessage(overlay)).toMatchObject({
      id: 'a1',
      content: [{ type: 'thinking', thinking: grown }],
    });
  });

  it('string content 同样只追加后缀', () => {
    const first = { role: 'assistant', content: '你好' };
    const cursor = buildLiveDeltaPayload(null, first).cursor;
    const second = buildLiveDeltaPayload(cursor, { role: 'assistant', content: '你好世界' });
    expect(readLiveAppend(second.payload)).toMatchObject({
      append: '世界',
      blockIndex: null,
      field: 'content',
    });
    expect(applyLiveMessagePayload(first, second.payload)?.content).toBe('你好');
    expect(materializeLiveMessage(applyLiveMessagePayload(first, second.payload))?.content).toBe('你好世界');
  });

  it('连续追加只增长 parts，不在 content 里拼出平方级全文', () => {
    let overlay = applyLiveMessagePayload(null, {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'a' }],
    });
    let cursor = buildLiveDeltaPayload(null, overlay as Record<string, unknown>).cursor;
    for (let index = 0; index < 40; index += 1) {
      const grown = 'a'.repeat(index + 2);
      const built = buildLiveDeltaPayload(cursor, {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: grown }],
      });
      cursor = built.cursor;
      overlay = applyLiveMessagePayload(overlay, built.payload);
    }
    const block = (overlay?.content as Array<{ thinking?: string }>)[0];
    expect(block?.thinking).toBe('a');
    expect((overlay?.[LIVE_PARTS_KEY] as string[]).join('')).toBe('a'.repeat(41));
    expect((overlay?.[LIVE_PARTS_KEY] as string[]).length).toBeLessThan(41);
    expect(materializeLiveMessage(overlay)).toMatchObject({
      content: [{ type: 'thinking', thinking: 'a'.repeat(41) }],
    });
  });

  it('结构变化（新增 tool_use）回退为完整快照，避免截掉工具块', () => {
    const thinking = { type: 'thinking', thinking: '准备调用' };
    const first = { role: 'assistant', content: [thinking] };
    const cursor = buildLiveDeltaPayload(null, first).cursor;
    const withTool = {
      role: 'assistant',
      content: [thinking, { type: 'tool_use', id: 't1', name: 'exec', input: { cmd: 'ls' } }],
    };
    const built = buildLiveDeltaPayload(cursor, withTool);
    expect(readLiveAppend(built.payload)).toBeNull();
    expect(built.payload).toEqual(withTool);
  });

  it('合帧时把连续 append 拼成一次追加', () => {
    const merged = mergeLiveDeltaPayloads(
      { role: 'assistant', _liveAppend: { append: '一', totalLength: 2, blockIndex: null, field: 'content' } },
      { role: 'assistant', _liveAppend: { append: '二', totalLength: 3, blockIndex: null, field: 'content' } },
    );
    expect(readLiveAppend(merged)).toMatchObject({ append: '一二', totalLength: 3 });
  });
});
