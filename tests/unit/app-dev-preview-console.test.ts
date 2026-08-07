import { describe, expect, it } from 'vitest';
import {
  formatHiddenPreviewFailureForAgent,
  isHiddenPreviewFailureMessage,
} from '@/lib/app-dev-preview-console';

describe('isHiddenPreviewFailureMessage', () => {
  it('keeps guest network hook and CORS-like console text', () => {
    expect(
      isHiddenPreviewFailureMessage(
        '[sclaw-preview-network] {"method":"POST","url":"https://baseinfo-chatbotapi-test.sto.cn/api/robot/page","ok":false,"error":"Failed to fetch"}',
      ),
    ).toBe(true);
    expect(
      isHiddenPreviewFailureMessage(
        "Access to fetch at 'https://x.sto.cn/api' has been blocked by CORS policy",
      ),
    ).toBe(true);
  });

  it('ignores UI framework noise and unrelated JS', () => {
    expect(isHiddenPreviewFailureMessage("[antd: Card] 'bordered' is deprecated")).toBe(false);
    expect(isHiddenPreviewFailureMessage('Uncaught TypeError: x is null')).toBe(false);
  });
});

describe('formatHiddenPreviewFailureForAgent', () => {
  it('frames as hidden failure for AI, not a page render bug', () => {
    const text = formatHiddenPreviewFailureForAgent(
      '[sclaw-preview-network] {"url":"https://x.sto.cn/api","error":"Failed to fetch"}',
      'http://127.0.0.1:1/#/list',
    );
    expect(text).toContain('页面上看不到');
    expect(text).toContain('https://x.sto.cn/api');
  });
});
