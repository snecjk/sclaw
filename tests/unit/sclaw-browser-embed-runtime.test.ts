import { describe, expect, it } from 'vitest';
import {
  createSclawBrowserChatSessionKeyForApp,
  createSclawBrowserEmbedRuntimeId,
  deriveSclawBrowserAppId,
  isSclawBrowserEmbedChatSessionForApp,
  isSclawBrowserEmbedChatSessionKey,
  parseSclawBrowserEmbedAppId,
  parseSclawBrowserEmbedConversationId,
  parseSclawBrowserEmbedRuntimeId,
} from '@/lib/sclaw-browser-chat-session';
import {
  appendSclawBrowserEmbedContext,
  buildSclawBrowserEmbedContextText,
  stripSclawBrowserEmbedContextForDisplay,
} from '@/lib/sclaw-browser-embed-context';
import { buildEmbedSessionLongContextNotice } from '@/lib/sclaw-browser-embed-context-compaction';

describe('sclaw-browser-chat-session', () => {
  it('uses stable app id in legacy single-session key', () => {
    const sessionKey = createSclawBrowserChatSessionKeyForApp('org-relation');
    expect(sessionKey).toBe('agent:main:session-embed-app-org-relation');
    expect(isSclawBrowserEmbedChatSessionKey(sessionKey)).toBe(true);
    expect(parseSclawBrowserEmbedAppId(sessionKey)).toBe('org-relation');
    expect(parseSclawBrowserEmbedConversationId(sessionKey)).toBe('default');
  });

  it('supports multi-conversation keys per app', () => {
    const sessionKey = createSclawBrowserChatSessionKeyForApp('org-relation', 'cabc123');
    expect(sessionKey).toBe('agent:main:session-embed-app-org-relation--cabc123');
    expect(parseSclawBrowserEmbedAppId(sessionKey)).toBe('org-relation');
    expect(parseSclawBrowserEmbedConversationId(sessionKey)).toBe('cabc123');
    expect(isSclawBrowserEmbedChatSessionForApp(sessionKey, 'org-relation')).toBe(true);
    expect(isSclawBrowserEmbedChatSessionForApp(sessionKey, 'other')).toBe(false);
  });

  it('still hides legacy runtime session keys', () => {
    const legacyKey = 'agent:main:session-embed-br-abc123';
    expect(isSclawBrowserEmbedChatSessionKey(legacyKey)).toBe(true);
    expect(parseSclawBrowserEmbedRuntimeId(legacyKey)).toBe('abc123');
  });

  it('derives app id from url when missing', () => {
    const appId = deriveSclawBrowserAppId({
      url: 'https://wd-vip.sto.cn/claw-businessOrganization?useStoToken=1',
    });
    expect(appId).toContain('wd-vip_sto_cn');
  });

  it('creates unique runtime ids', () => {
    const a = createSclawBrowserEmbedRuntimeId();
    const b = createSclawBrowserEmbedRuntimeId();
    expect(a).not.toBe(b);
    expect(a.startsWith('br-')).toBe(true);
  });
});

describe('sclaw-browser-embed-context', () => {
  const baseContext = {
    embedRuntimeId: 'br-test',
    bridgeSessionId: 'embed-br-test',
    appTitle: '政策管家',
    pageUrl: 'https://zc.sto.cn/',
    pageTitle: 'STO 政策管家',
    visibleTextExcerpt: '业务量完成率 33.94%',
    capturedAt: 1,
    recentNetworkRequests: [{ method: 'GET', url: 'https://zc.sto.cn/api/metrics', statusCode: 200 }],
  };

  it('includes bridgeSessionId and bridge tools hint by default', () => {
    const text = buildSclawBrowserEmbedContextText(baseContext);
    expect(text).toContain('embedRuntimeId');
    expect(text).toContain('br-test');
    expect(text).toContain('bridge_snapshot');
    expect(text).toContain('ba_observe');
    expect(text).toContain('embed-br-test');
    expect(text).toContain('业务量完成率');
  });

  it('uses quote-skill priority prompt when quoteSkillActive', () => {
    const text = buildSclawBrowserEmbedContextText(baseContext, { quoteSkillActive: true });
    expect(text).toContain('报价助手技能已激活');
    expect(text).toContain('调价上传弹窗');
    expect(text).toContain('在 flow_card 上输出「提交报价」');
    expect(text).toContain('--objectListJson');
    expect(text).toContain('--quotationListJson');
    expect(text).not.toContain('ba_observe');
    expect(text).not.toContain('automationTools');
  });

  it('strips hidden context for display', () => {
    const userText = '你能看到我左侧加载了什么吗';
    const withContext = appendSclawBrowserEmbedContext(userText, {
      embedRuntimeId: 'br-test',
      bridgeSessionId: 'embed-br-test',
      appTitle: '政策管家',
      pageUrl: 'https://zc.sto.cn/',
      pageTitle: 'STO 政策管家',
      visibleTextExcerpt: 'dashboard',
      capturedAt: 1,
    });
    expect(stripSclawBrowserEmbedContextForDisplay(withContext)).toBe(userText);
  });
});

describe('sclaw-browser-embed-context-compaction', () => {
  it('warns when session is long', () => {
    expect(buildEmbedSessionLongContextNotice(10)).toBeNull();
    expect(buildEmbedSessionLongContextNotice(50)).toContain('长会话');
  });
});
