import { describe, expect, it } from 'vitest';
import {
  appendDingTalkAgentSendDisclaimer,
  stripDingTalkAgentSendDisclaimerForDisplay,
} from '../../shared/dingtalk-prompts/dingtalk-disclaimer';
import { extractText } from '../../src/pages/Chat/message-utils';

describe('stripDingTalkAgentSendDisclaimerForDisplay', () => {
  it('removes html disclaimer footer from draft preview text', () => {
    const draft = appendDingTalkAgentSendDisclaimer('上海明日天气\n\n适合外出，注意防晒补水 🧴');
    expect(stripDingTalkAgentSendDisclaimerForDisplay(draft)).toBe(
      '上海明日天气\n\n适合外出，注意防晒补水 🧴',
    );
  });
});

describe('extractText assistant display', () => {
  it('hides disclaimer when assistant echoes send draft', () => {
    const message = {
      role: 'assistant',
      content: appendDingTalkAgentSendDisclaimer('确认草稿正文') + '\n\n确认发送吗？',
    };
    const text = extractText(message);
    expect(text).toContain('确认草稿正文');
    expect(text).toContain('确认发送吗？');
    expect(text).not.toContain('<font');
    expect(text).not.toContain('代为发送');
  });
});
