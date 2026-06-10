import { describe, expect, it } from 'vitest';
import {
  extractThinking,
  maskDwsSensitiveIdsForDisplay,
  maskSensitiveToolInputForDisplay,
} from '../../src/pages/Chat/message-utils';

describe('maskDwsSensitiveIdsForDisplay', () => {
  it('masks userid in prose parentheses inside thinking', () => {
    const input = '通过钉钉发送给@文鹏 (userid: 0161271920846248)，查询上海天气。';
    expect(maskDwsSensitiveIdsForDisplay(input)).toBe(
      '通过钉钉发送给@文鹏 (userid: ***)，查询上海天气。',
    );
  });

  it('masks dws CLI recipient flags', () => {
    const input = 'dws chat message send --user 0161271920846248 --title "消息"';
    expect(maskDwsSensitiveIdsForDisplay(input)).toBe(
      'dws chat message send --user *** --title "消息"',
    );
  });

  it('masks JSON recipient fields', () => {
    const input = '{"userId":"0161271920846248","displayName":"文鹏"}';
    expect(maskDwsSensitiveIdsForDisplay(input)).toBe(
      '{"userId":"***","displayName":"文鹏"}',
    );
  });

  it('masks inline userid label without parentheses', () => {
    const input = '收件人 userid: 0161271920846248 已确认';
    expect(maskDwsSensitiveIdsForDisplay(input)).toBe('收件人 userid: *** 已确认');
  });

  it('masks inline userid label with double-quoted value', () => {
    const input = '收件人 JSON 中已有 userid: "0161271920846248"，准备发送图片。';
    expect(maskDwsSensitiveIdsForDisplay(input)).toBe(
      '收件人 JSON 中已有 userid: ***，准备发送图片。',
    );
  });

  it('masks lowercase userid in JSON fields', () => {
    const input = '{"userid":"0161271920846248","displayName":"文鹏"}';
    expect(maskDwsSensitiveIdsForDisplay(input)).toBe(
      '{"userid":"***","displayName":"文鹏"}',
    );
  });

  it('masks Chinese group id label in thinking prose', () => {
    const input = '群ID：cidtc85GkR9lPhV9dy3UDm8ag==，准备发送天气。';
    expect(maskDwsSensitiveIdsForDisplay(input)).toBe('群ID：***，准备发送天气。');
  });

  it('masks quoted --group flag in exec command JSON', () => {
    const input =
      '{"command":"dws chat message send --group \\"cidtc85GkR9lPhV9dy3UDm8ag==\\" --title \\"上海明日天气\\""}';
    const masked = maskDwsSensitiveIdsForDisplay(input);
    expect(masked).toContain('--group ***');
    expect(masked).not.toContain('cidtc85GkR9lPhV9dy3UDm8ag==');
  });

  it('cleans leaked group id after partial mask', () => {
    const input = 'dws chat message send --group ***\\"cidtc85GkR9lPhV9dy3UDm8ag==\\" --title "消息"';
    const masked = maskDwsSensitiveIdsForDisplay(input);
    expect(masked).toBe('dws chat message send --group *** --title "消息"');
  });
});

describe('extractThinking', () => {
  it('applies masking to thinking blocks', () => {
    const message = {
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          thinking: '通过钉钉发送给@文鹏 (userid: 0161271920846248)',
        },
      ],
    };
    expect(extractThinking(message)).toBe('通过钉钉发送给@文鹏 (userid: ***)');
  });
});

describe('maskSensitiveToolInputForDisplay', () => {
  it('masks command strings in tool input', () => {
    const input = 'dws chat message send --user 0161271920846248 --format json';
    expect(maskSensitiveToolInputForDisplay(input)).toContain('--user ***');
  });
});
