import { describe, expect, it } from 'vitest';
import { appendDingTalkAgentSendDisclaimer } from '../../shared/dingtalk-prompts/dingtalk-disclaimer';
import { buildDingTalkMentionSystemContext } from '../../shared/dingtalk-prompts/dingtalk-mention-context';
import {
  extractDingTalkSentPreviews,
  formatDingTalkSentTextForChatPreview,
  parseDwsChatMessageSendCommand,
  stripEchoedDingTalkSentBodiesFromAssistantReply,
  splitDingTalkSentPreviewText,
} from '../../shared/dingtalk-send/dingtalk-sent-display';

describe('parseDwsChatMessageSendCommand', () => {
  it('parses JSON.stringify --text with disclaimer footer', () => {
    const textExample = appendDingTalkAgentSendDisclaimer('你好');
    const cmd = `dws chat message send --user uid-1 --title "消息" --text ${JSON.stringify(textExample)} --format json`;
    const parsed = parseDwsChatMessageSendCommand(cmd);
    expect(parsed).not.toBeNull();
    expect(parsed?.title).toBe('消息');
    expect(parsed?.recipientLabel).toBe('联系人');
    expect(parsed?.text).toContain('你好');
    expect(parsed?.text).toContain('SClaw 代为发送');
  });

  it('renders disclaimer footer as markdown quote in sent-success preview', () => {
    const text = appendDingTalkAgentSendDisclaimer('正文内容');
    const preview = formatDingTalkSentTextForChatPreview(text);
    expect(preview).toContain('正文内容');
    expect(preview).not.toContain('SClaw 代为发送');
    expect(preview).not.toContain('<font');
  });

  it('splits malformed font disclaimer for UI footer', () => {
    const malformed = [
      '正文内容',
      '',
      '---',
      '',
      `<font color="'#999999'">本消息由 SClaw 代为发送，非本人实时回复。</font>`,
    ].join('\n');
    const { body, disclaimer } = splitDingTalkSentPreviewText(malformed);
    expect(body).toBe('正文内容');
    expect(disclaimer).toBe('本消息由 SClaw 代为发送，非本人实时回复。');
    expect(formatDingTalkSentTextForChatPreview(malformed)).toBe('正文内容');
  });
});

describe('extractDingTalkSentPreviews', () => {
  it('shows preview only when tool result indicates success', () => {
    const textExample = appendDingTalkAgentSendDisclaimer('测试消息');
    const command = `dws chat message send --user uid-1 --title "消息" --text ${JSON.stringify(textExample)} --format json`;
    const turnMessages = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'bash',
            input: { command },
          },
        ],
      },
    ];
    const successResults = [
      {
        role: 'tool',
        toolCallId: 'tool-1',
        content: [{ type: 'text', text: '{"ok":true,"openTaskId":"task-1"}' }],
      },
    ];
    const failedResults = [
      {
        role: 'tool',
        toolCallId: 'tool-1',
        isError: true,
        content: [{ type: 'text', text: '{"ok":false,"error":"send failed"}' }],
      },
    ];

    expect(extractDingTalkSentPreviews(turnMessages, successResults)).toHaveLength(1);
    expect(extractDingTalkSentPreviews(turnMessages, failedResults)).toHaveLength(0);
  });

  it('resolves group display name from injected recipient JSON', () => {
    const textExample = appendDingTalkAgentSendDisclaimer('你好');
    const groupId = 'cidtc85GkR9lPhV9dy3UDm8ag==';
    const userMessageRaw = [
      buildDingTalkMentionSystemContext([
        {
          type: 'group',
          displayName: '自研Claw',
          openConversationId: groupId,
        },
      ]),
      '',
      '---',
      '',
      '用户消息：',
      '你好',
    ].join('\n');
    const command = `dws chat message send --group ${groupId} --title "消息" --text ${JSON.stringify(textExample)} --format json`;
    const turnMessages = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'bash',
            input: { command },
          },
        ],
      },
    ];
    const toolResults = [
      {
        role: 'tool',
        toolCallId: 'tool-1',
        content: [{ type: 'text', text: '{"ok":true}' }],
      },
    ];

    const previews = extractDingTalkSentPreviews(turnMessages, toolResults, { userMessageRaw });
    expect(previews).toHaveLength(1);
    expect(previews[0]?.recipientLabel).toBe('自研Claw');
  });

  it('falls back to assistant reply when group name is only in confirmation text', () => {
    const textExample = appendDingTalkAgentSendDisclaimer('你好');
    const command = `dws chat message send --group cid-hidden --title "消息" --text ${JSON.stringify(textExample)} --format json`;
    const turnMessages = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'bash',
            input: { command },
          },
          {
            type: 'text',
            text: '✅ 已将「你好」发送给「自研Claw」群。',
          },
        ],
      },
    ];
    const toolResults = [
      {
        role: 'tool',
        toolCallId: 'tool-1',
        content: [{ type: 'text', text: '{"ok":true}' }],
      },
    ];

    const previews = extractDingTalkSentPreviews(turnMessages, toolResults, {
      assistantReplyText: '✅ 已将「你好」发送给「自研Claw」群。',
    });
    expect(previews).toHaveLength(1);
    expect(previews[0]?.recipientLabel).toBe('自研Claw');
  });

  it('dedupes multiple successful sends with the same body to the same recipient', () => {
    const disclaimer = appendDingTalkAgentSendDisclaimer('你好');
    const textShell = `$'${disclaimer.replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
    const base = `dws chat message send --user uid-wp --title "消息" --text ${textShell}`;
    const turnMessages = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'bash',
            input: { command: `${base} --media /tmp/outbound/demo.png --format json` },
          },
          {
            type: 'tool_use',
            id: 'tool-2',
            name: 'bash',
            input: { command: `${base} --format json` },
          },
          {
            type: 'tool_use',
            id: 'tool-3',
            name: 'bash',
            input: {
              command: `${base} --msg-type file --dentry-id dentry-1 --space-id space-1 --format json`,
            },
          },
        ],
      },
    ];
    const toolResults = [
      { role: 'tool', toolCallId: 'tool-1', content: [{ type: 'text', text: '{"ok":true}' }] },
      { role: 'tool', toolCallId: 'tool-2', content: [{ type: 'text', text: '{"ok":true}' }] },
      { role: 'tool', toolCallId: 'tool-3', content: [{ type: 'text', text: '{"ok":true}' }] },
    ];

    const previews = extractDingTalkSentPreviews(turnMessages, toolResults, {
      mentionHints: ['文鹏'],
    });
    expect(previews).toHaveLength(1);
    expect(previews[0]?.recipientLabel).toBe('文鹏');
    expect(previews[0]?.text).toContain('你好');
  });

  it('uses @ mention hints when recipient label is generic', () => {
    const textExample = appendDingTalkAgentSendDisclaimer('测试消息');
    const command = `dws chat message send --user uid-1 --title "申通快递浙江嘉兴洪合公司信息" --text ${JSON.stringify(textExample)} --format json`;
    const turnMessages = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'bash',
            input: { command },
          },
        ],
      },
    ];
    const toolResults = [
      {
        role: 'tool',
        toolCallId: 'tool-1',
        content: [{ type: 'text', text: '{"ok":true}' }],
      },
    ];

    const previews = extractDingTalkSentPreviews(turnMessages, toolResults, {
      mentionHints: ['文鹏'],
    });
    expect(previews).toHaveLength(1);
    expect(previews[0]?.recipientLabel).toBe('文鹏');
    expect(previews[0]?.title).toBe('申通快递浙江嘉兴洪合公司信息');
  });

  it('strips echoed send bodies from assistant reply when preview card is shown', () => {
    const body = '### 上海明日天气\n\n晴，8km/h 风速';
    const textExample = appendDingTalkAgentSendDisclaimer(body);
    const previews = extractDingTalkSentPreviews(
      [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-1',
              name: 'bash',
              input: {
                command: `dws chat message send --user uid-1 --title "消息" --text ${JSON.stringify(textExample)} --format json`,
              },
            },
          ],
        },
      ],
      [{ role: 'tool', toolCallId: 'tool-1', content: [{ type: 'text', text: '{"ok":true}' }] }],
      { mentionHints: ['文鹏'] },
    );
    const reply = `${body}\n\n✅ 已将上海明天天气预报发送给文鹏。`;
    const stripped = stripEchoedDingTalkSentBodiesFromAssistantReply(reply, previews);
    expect(stripped).not.toContain('上海明日天气');
    expect(stripped).toContain('已将上海明天天气预报发送给文鹏');
  });
});
