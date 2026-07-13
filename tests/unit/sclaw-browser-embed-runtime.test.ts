import { describe, expect, it } from 'vitest';
import {
  createSclawBrowserChatSessionKey,
  createSclawBrowserEmbedRuntimeId,
  isSclawBrowserEmbedChatSessionKey,
  parseSclawBrowserEmbedRuntimeId,
} from '@/lib/sclaw-browser-chat-session';
import {
  appendSclawBrowserEmbedContext,
  buildSclawBrowserEmbedContextText,
  stripSclawBrowserEmbedContextForDisplay,
} from '@/lib/sclaw-browser-embed-context';

describe('sclaw-browser-chat-session', () => {
  it('encodes runtime id in session key', () => {
    const runtimeId = 'br-abc123';
    const sessionKey = createSclawBrowserChatSessionKey(runtimeId);
    expect(sessionKey).toBe('agent:main:session-embed-br-abc123');
    expect(isSclawBrowserEmbedChatSessionKey(sessionKey)).toBe(true);
    expect(parseSclawBrowserEmbedRuntimeId(sessionKey)).toBe(runtimeId);
  });

  it('creates unique runtime ids', () => {
    const a = createSclawBrowserEmbedRuntimeId();
    const b = createSclawBrowserEmbedRuntimeId();
    expect(a).not.toBe(b);
    expect(a.startsWith('br-')).toBe(true);
  });
});

describe('sclaw-browser-embed-context', () => {
  it('includes embedRuntimeId and hostApi routes', () => {
    const text = buildSclawBrowserEmbedContextText({
      embedRuntimeId: 'br-test',
      appTitle: '政策管家',
      pageUrl: 'https://zc.sto.cn/',
      pageTitle: 'STO 政策管家',
      visibleTextExcerpt: '业务量完成率 33.94%',
      capturedAt: 1,
      recentNetworkRequests: [{ method: 'GET', url: 'https://zc.sto.cn/api/metrics', statusCode: 200 }],
    });
    expect(text).toContain('embedRuntimeId');
    expect(text).toContain('br-test');
    expect(text).toContain('/api/sclaw-browser/runtime/br-test/capture');
    expect(text).toContain('业务量完成率');
  });

  it('strips hidden context for display', () => {
    const userText = '你能看到我左侧加载了什么吗';
    const withContext = appendSclawBrowserEmbedContext(userText, {
      embedRuntimeId: 'br-test',
      appTitle: '政策管家',
      pageUrl: 'https://zc.sto.cn/',
      pageTitle: 'STO 政策管家',
      visibleTextExcerpt: 'dashboard',
      capturedAt: 1,
    });
    expect(stripSclawBrowserEmbedContextForDisplay(withContext)).toBe(userText);
  });
});
