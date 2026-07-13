import { describe, expect, it } from 'vitest';
import {
  extractThinking,
  maskDwsSensitiveIdsForDisplay,
  maskSensitiveToolInputForDisplay,
  hasDisplayableToolInput,
} from '../../src/pages/Chat/message-utils';

/** 明显虚构的钉钉 ID，仅用于脱敏规则单测，非真实业务数据。 */
const FIXTURE_USER_ID = '0000000000000001';
const FIXTURE_GROUP_CID = 'cidFIXTURE0000000001fake==';

describe('maskDwsSensitiveIdsForDisplay', () => {
  it('masks userid in prose parentheses inside thinking', () => {
    const input = `通过钉钉发送给@示例联系人 (userid: ${FIXTURE_USER_ID})，查询上海天气。`;
    expect(maskDwsSensitiveIdsForDisplay(input)).toBe(
      '通过钉钉发送给@示例联系人 (userid: ***)，查询上海天气。',
    );
  });

  it('masks dws CLI recipient flags', () => {
    const input = `dws chat message send --user ${FIXTURE_USER_ID} --title "消息"`;
    expect(maskDwsSensitiveIdsForDisplay(input)).toBe(
      'dws chat message send --user *** --title "消息"',
    );
  });

  it('masks JSON recipient fields', () => {
    const input = `{"userId":"${FIXTURE_USER_ID}","displayName":"示例联系人"}`;
    expect(maskDwsSensitiveIdsForDisplay(input)).toBe(
      '{"userId":"***","displayName":"示例联系人"}',
    );
  });

  it('masks inline userid label without parentheses', () => {
    const input = `收件人 userid: ${FIXTURE_USER_ID} 已确认`;
    expect(maskDwsSensitiveIdsForDisplay(input)).toBe('收件人 userid: *** 已确认');
  });

  it('masks inline userid label with double-quoted value', () => {
    const input = `收件人 JSON 中已有 userid: "${FIXTURE_USER_ID}"，准备发送图片。`;
    expect(maskDwsSensitiveIdsForDisplay(input)).toBe(
      '收件人 JSON 中已有 userid: ***，准备发送图片。',
    );
  });

  it('masks lowercase userid in JSON fields', () => {
    const input = `{"userid":"${FIXTURE_USER_ID}","displayName":"示例联系人"}`;
    expect(maskDwsSensitiveIdsForDisplay(input)).toBe(
      '{"userid":"***","displayName":"示例联系人"}',
    );
  });

  it('masks Chinese group id label in thinking prose', () => {
    const input = `群ID：${FIXTURE_GROUP_CID}，准备发送天气。`;
    expect(maskDwsSensitiveIdsForDisplay(input)).toBe('群ID：***，准备发送天气。');
  });

  it('masks quoted --group flag in exec command JSON', () => {
    const input =
      `{"command":"dws chat message send --group \\"${FIXTURE_GROUP_CID}\\" --title \\"上海明日天气\\""}`;
    const masked = maskDwsSensitiveIdsForDisplay(input);
    expect(masked).toContain('--group ***');
    expect(masked).not.toContain(FIXTURE_GROUP_CID);
  });

  it('cleans leaked group id after partial mask', () => {
    const input = `dws chat message send --group ***\\"${FIXTURE_GROUP_CID}\\" --title "消息"`;
    const masked = maskDwsSensitiveIdsForDisplay(input);
    expect(masked).toBe('dws chat message send --group *** --title "消息"');
  });

  it('masks colon-separated --user flag in thinking bullet list', () => {
    const input = `- --user: ${FIXTURE_USER_ID}\n- --title: 消息\n- --text: 早上好老板`;
    expect(maskDwsSensitiveIdsForDisplay(input)).toBe(
      '- --user: ***\n- --title: 消息\n- --text: 早上好老板',
    );
  });

  it('masks bare numeric userId in parentheses after JSON block mention', () => {
    const input = `userId 来自 JSON 块 (${FIXTURE_USER_ID})，准备发送。`;
    expect(maskDwsSensitiveIdsForDisplay(input)).toBe('userId 来自 JSON 块 (***)，准备发送。');
  });

  it('masks camelCase userId inline label', () => {
    const input = `JSON 中 userId: ${FIXTURE_USER_ID} 已确认`;
    expect(maskDwsSensitiveIdsForDisplay(input)).toBe('JSON 中 userId: *** 已确认');
  });
});

describe('extractThinking', () => {
  it('applies masking to thinking blocks', () => {
    const message = {
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          thinking: `通过钉钉发送给@示例联系人 (userid: ${FIXTURE_USER_ID})`,
        },
      ],
    };
    expect(extractThinking(message)).toBe('通过钉钉发送给@示例联系人 (userid: ***)');
  });

  it('masks colon-style flags and bare JSON block userId in thinking', () => {
    const message = {
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          thinking:
            `userId 来自 JSON 块 (${FIXTURE_USER_ID})\n- --user: ${FIXTURE_USER_ID}\n- --title: 消息`,
        },
      ],
    };
    expect(extractThinking(message)).toBe(
      'userId 来自 JSON 块 (***)\n- --user: ***\n- --title: 消息',
    );
  });
});

describe('maskSensitiveToolInputForDisplay', () => {
  it('masks command strings in tool input', () => {
    const input = `dws chat message send --user ${FIXTURE_USER_ID} --format json`;
    expect(maskSensitiveToolInputForDisplay(input)).toContain('--user ***');
  });
});

describe('hasDisplayableToolInput', () => {
  it('treats null, empty object, and blank string as no params', () => {
    expect(hasDisplayableToolInput(null)).toBe(false);
    expect(hasDisplayableToolInput(undefined)).toBe(false);
    expect(hasDisplayableToolInput({})).toBe(false);
    expect(hasDisplayableToolInput('   ')).toBe(false);
  });

  it('accepts non-empty object or string', () => {
    expect(hasDisplayableToolInput({ command: 'ls' })).toBe(true);
    expect(hasDisplayableToolInput('pwd')).toBe(true);
  });
});
