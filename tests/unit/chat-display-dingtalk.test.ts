import { describe, expect, it } from 'vitest';
import { buildChatDisplayItems } from '../../src/pages/Chat/chat-display';
import type { RawMessage } from '@/stores/chat';

describe('buildChatDisplayItems DingTalk preview routing', () => {
  it('uses assistant-turn for a single assistant message that includes tool_use', () => {
    const messages: RawMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        content: '发送天气给 @文鹏',
        timestamp: 1,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'bash',
            input: {
              command: 'dws chat message send --user u1 --title 消息 --text "上海明天 30C" --format json',
            },
          },
          { type: 'text', text: '已将天气预报发送给文鹏。' },
        ],
        timestamp: 2,
      },
      {
        id: 'tool-1',
        role: 'toolresult',
        toolCallId: 'tool-1',
        content: [{ type: 'text', text: '{"ok":true}' }],
        timestamp: 3,
      },
    ];

    const items = buildChatDisplayItems(messages);
    const assistantItem = items.find((item) => item.type === 'assistant-turn');
    expect(assistantItem?.type).toBe('assistant-turn');
    if (assistantItem?.type === 'assistant-turn') {
      expect(assistantItem.toolResults).toHaveLength(1);
      expect(assistantItem.messages).toHaveLength(1);
    }
  });
});
